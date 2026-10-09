package commands

import (
	"context"
	"errors"
	"fmt"
	"os"
	"regexp"
	"runtime"
	"strconv"
	"strings"
)

type patch struct {
	ExternalID     string `json:"externalId"`
	Title          string `json:"title"`
	Description    string `json:"description,omitempty"`
	Source         string `json:"source"`
	Category       string `json:"category"`
	Severity       string `json:"severity"`
	KB             string `json:"kb,omitempty"`
	Version        string `json:"version,omitempty"`
	CurrentVersion string `json:"currentVersion,omitempty"`
	SizeBytes      int64  `json:"sizeBytes,omitempty"`
	RebootRequired bool   `json:"rebootRequired"`
	ReleaseDate    string `json:"releaseDate,omitempty"`
	SupportURL     string `json:"supportUrl,omitempty"`
}

// PatchScan lists updates the OS package manager / Windows Update would apply.
func PatchScan(ctx context.Context, c *Command) (interface{}, error) {
	var patches []patch
	var err error
	var manager string
	switch runtime.GOOS {
	case "windows":
		manager = "windows_update"
		patches, err = windowsUpdateScan(ctx, c)
	case "darwin":
		manager = "macos_softwareupdate"
		patches, err = macUpdateScan(ctx, c)
	default:
		manager, patches, err = linuxUpdateScan(ctx, c)
	}
	if err != nil {
		return nil, err
	}
	if patches == nil {
		patches = []patch{}
	}
	reboot, _ := pendingRebootHint()
	return map[string]interface{}{"manager": manager, "patches": patches, "count": len(patches), "rebootPending": reboot}, nil
}

// PatchInstall: { externalIds?: [...], all?: bool, reboot?: bool }
func PatchInstall(ctx context.Context, c *Command) (interface{}, error) {
	var a struct {
		ExternalIDs []string `json:"externalIds"`
		All         bool     `json:"all"`
		Reboot      bool     `json:"reboot"`
	}
	if err := c.Arg(&a); err != nil {
		return nil, err
	}
	if !a.All && len(a.ExternalIDs) == 0 {
		return nil, errors.New("externalIds or all=true is required")
	}
	var res map[string]interface{}
	var err error
	switch runtime.GOOS {
	case "windows":
		res, err = windowsUpdateInstall(ctx, c, a.ExternalIDs, a.All)
	case "darwin":
		res, err = macUpdateInstall(ctx, c, a.ExternalIDs, a.All)
	default:
		res, err = linuxUpdateInstall(ctx, c, a.ExternalIDs, a.All)
	}
	if err != nil {
		return res, err
	}
	if a.Reboot && boolean(res, "rebootRequired") {
		c.Emit("stdout", []byte("\nRebooting as requested…\n"))
		_, _ = power(ctx, c, "reboot")
	}
	return res, nil
}

/* ------------------------------------------------------------------ Windows (Windows Update Agent COM) */

func windowsUpdateScan(ctx context.Context, c *Command) ([]patch, error) {
	c.Emit("stdout", []byte("Searching Windows Update…\n"))
	script := `$s=New-Object -ComObject Microsoft.Update.Session
$r=$s.CreateUpdateSearcher().Search("IsInstalled=0 and IsHidden=0 and Type='Software'")
$out=@()
foreach($u in $r.Updates){
  $cats=@(); foreach($x in $u.Categories){$cats+=$x.Name}
  $kb=@(); foreach($k in $u.KBArticleIDs){$kb+=("KB"+$k)}
  $out += [pscustomobject]@{ id=$u.Identity.UpdateID; title=$u.Title; description= if($u.Description){$u.Description.Substring(0,[Math]::Min(600,$u.Description.Length))} else {''}; kb=($kb -join ','); size=[int64]$u.MaxDownloadSize; severity=[string]$u.MsrcSeverity; categories=($cats -join ','); reboot=[bool]$u.RebootRequired; date= if($u.LastDeploymentChangeTime){$u.LastDeploymentChangeTime.ToUniversalTime().ToString('o')} else {''}; supportUrl=[string]$u.SupportUrl }
}
$out | ConvertTo-Json -Compress -Depth 3`
	rows, err := psJSON(ctx, script, "")
	if err != nil {
		return nil, err
	}
	out := make([]patch, 0, len(rows))
	for _, r := range rows {
		cats := strings.ToLower(str(r, "categories"))
		cat := "other"
		switch {
		case strings.Contains(cats, "security"):
			cat = "security"
		case strings.Contains(cats, "critical"):
			cat = "critical"
		case strings.Contains(cats, "definition"):
			cat = "definition"
		case strings.Contains(cats, "driver"):
			cat = "driver"
		case strings.Contains(cats, "feature"), strings.Contains(cats, "upgrade"):
			cat = "feature"
		case strings.Contains(cats, "update"):
			cat = "important"
		}
		sev := strings.ToLower(str(r, "severity"))
		if sev == "" {
			sev = "unknown"
		}
		out = append(out, patch{ExternalID: str(r, "id"), Title: str(r, "title"), Description: str(r, "description"), Source: "windows_update", Category: cat, Severity: sev, KB: str(r, "kb"), SizeBytes: int64(num(r, "size")), RebootRequired: boolean(r, "reboot"), ReleaseDate: str(r, "date"), SupportURL: str(r, "supportUrl")})
	}
	return out, nil
}

func windowsUpdateInstall(ctx context.Context, c *Command, ids []string, all bool) (map[string]interface{}, error) {
	quoted := make([]string, 0, len(ids))
	for _, id := range ids {
		quoted = append(quoted, psq(id))
	}
	idList := "@(" + strings.Join(quoted, ",") + ")"
	if all {
		idList = "@()"
	}
	script := `$ids=` + idList + `
$s=New-Object -ComObject Microsoft.Update.Session
$r=$s.CreateUpdateSearcher().Search("IsInstalled=0 and IsHidden=0 and Type='Software'")
$coll=New-Object -ComObject Microsoft.Update.UpdateColl
foreach($u in $r.Updates){ if($ids.Count -eq 0 -or $ids -contains $u.Identity.UpdateID){ if(-not $u.EulaAccepted){ $u.AcceptEula() }; [void]$coll.Add($u) } }
if($coll.Count -eq 0){ '{"installed":[],"failed":[],"rebootRequired":false,"message":"nothing to install"}'; exit 0 }
[Console]::Error.WriteLine("Downloading " + $coll.Count + " update(s)…")
$d=$s.CreateUpdateDownloader(); $d.Updates=$coll; [void]$d.Download()
[Console]::Error.WriteLine("Installing…")
$i=$s.CreateUpdateInstaller(); $i.Updates=$coll; $ir=$i.Install()
$res=@{installed=@(); failed=@(); rebootRequired=[bool]$ir.RebootRequired}
for($k=0;$k -lt $coll.Count;$k++){ $u=$coll.Item($k); $code=$ir.GetUpdateResult($k).ResultCode; if($code -eq 2){ $res.installed += $u.Identity.UpdateID } else { $res.failed += @{id=$u.Identity.UpdateID; title=$u.Title; code=$code; hresult=('0x{0:X8}' -f $ir.GetUpdateResult($k).HResult)} } }
$res | ConvertTo-Json -Compress -Depth 3`
	rows, err := psJSON(ctx, script, "")
	if err != nil {
		return nil, err
	}
	if len(rows) == 0 {
		return map[string]interface{}{"installed": []string{}, "failed": []interface{}{}, "rebootRequired": false}, nil
	}
	return rows[0], nil
}

/* ------------------------------------------------------------------ Linux (apt / dnf / yum / zypper) */

var aptUpgradableRe = regexp.MustCompile(`^([^/\s]+)/(\S+)\s+(\S+)\s+(\S+)(?:\s+\[upgradable from:\s+([^\]]+)\])?`)

func linuxUpdateScan(ctx context.Context, c *Command) (string, []patch, error) {
	switch {
	case has("apt-get"):
		c.Emit("stdout", []byte("apt-get update…\n"))
		if _, err := runOut(ctx, "apt-get", "update", "-qq"); err != nil {
			c.Emit("stderr", []byte(err.Error()+"\n"))
		}
		out, err := runOut(ctx, "apt", "list", "--upgradable")
		if err != nil && out == "" {
			return "apt", nil, err
		}
		var patches []patch
		for _, line := range strings.Split(out, "\n") {
			m := aptUpgradableRe.FindStringSubmatch(strings.TrimSpace(line))
			if m == nil {
				continue
			}
			suite := m[2]
			cat, sev := "important", "moderate"
			if strings.Contains(suite, "security") {
				cat, sev = "security", "important"
			}
			patches = append(patches, patch{ExternalID: m[1], Title: m[1] + " " + m[3], Source: "apt", Category: cat, Severity: sev, Version: m[3], CurrentVersion: m[5], Description: "from " + suite})
		}
		return "apt", patches, nil
	case has("dnf"), has("yum"):
		tool := "dnf"
		if !has("dnf") {
			tool = "yum"
		}
		c.Emit("stdout", []byte(tool+" check-update…\n"))
		out, _ := runOut(ctx, tool, "-q", "check-update") // exit 100 = updates available
		security := map[string]bool{}
		if sec, err := runOut(ctx, tool, "-q", "updateinfo", "list", "--security"); err == nil {
			for _, line := range strings.Split(sec, "\n") {
				f := strings.Fields(line)
				if len(f) >= 3 {
					security[f[len(f)-1]] = true
				}
			}
		}
		var patches []patch
		for _, line := range strings.Split(out, "\n") {
			f := strings.Fields(line)
			if len(f) < 3 || strings.HasPrefix(line, "Obsoleting") {
				continue
			}
			name := f[0]
			cat, sev := "important", "moderate"
			for k := range security {
				if strings.HasPrefix(k, strings.TrimSuffix(name, ".x86_64")) {
					cat, sev = "security", "important"
				}
			}
			patches = append(patches, patch{ExternalID: name, Title: name + " " + f[1], Source: "dnf", Category: cat, Severity: sev, Version: f[1], Description: "from " + f[2]})
		}
		return "dnf", patches, nil
	case has("zypper"):
		out, _ := runOut(ctx, "zypper", "--non-interactive", "list-updates")
		var patches []patch
		for _, line := range strings.Split(out, "\n") {
			f := strings.Split(line, "|")
			if len(f) < 5 || strings.TrimSpace(f[0]) != "v" {
				continue
			}
			name, cur, next := strings.TrimSpace(f[2]), strings.TrimSpace(f[3]), strings.TrimSpace(f[4])
			patches = append(patches, patch{ExternalID: name, Title: name + " " + next, Source: "zypper", Category: "important", Severity: "moderate", Version: next, CurrentVersion: cur})
		}
		return "zypper", patches, nil
	}
	return "other", nil, errors.New("no supported package manager found (apt, dnf, yum, zypper)")
}

func linuxUpdateInstall(ctx context.Context, c *Command, ids []string, all bool) (map[string]interface{}, error) {
	var err error
	switch {
	case has("apt-get"):
		args := []string{"-y", "-o", "Dpkg::Options::=--force-confdef", "-o", "Dpkg::Options::=--force-confold"}
		if all {
			args = append(args, "upgrade")
		} else {
			args = append(append(args, "install", "--only-upgrade"), ids...)
		}
		err = runProcess(ctx, c, "apt-get", args, []string{"DEBIAN_FRONTEND=noninteractive"}, "", "")
	case has("dnf"), has("yum"):
		tool := "dnf"
		if !has("dnf") {
			tool = "yum"
		}
		args := []string{"-y", "upgrade"}
		if !all {
			args = append(args, ids...)
		}
		err = runProcess(ctx, c, tool, args, nil, "", "")
	case has("zypper"):
		args := []string{"--non-interactive", "update"}
		if !all {
			args = append(args, ids...)
		}
		err = runProcess(ctx, c, "zypper", args, nil, "", "")
	default:
		return nil, errors.New("no supported package manager found")
	}
	reboot, _ := pendingRebootHint()
	res := map[string]interface{}{"installed": ids, "rebootRequired": reboot}
	if c.exit != nil && *c.exit != 0 {
		return res, fmt.Errorf("package manager exited with code %d", *c.exit)
	}
	return res, err
}

/* ------------------------------------------------------------------ macOS (softwareupdate) */

var macLabelRe = regexp.MustCompile(`^\*\s+Label:\s+(.+)$`)

func macUpdateScan(ctx context.Context, c *Command) ([]patch, error) {
	c.Emit("stdout", []byte("softwareupdate --list…\n"))
	out, _ := runOut(ctx, "softwareupdate", "-l", "--no-scan")
	if !strings.Contains(out, "Label:") {
		out, _ = runOut(ctx, "softwareupdate", "-l")
	}
	var patches []patch
	lines := strings.Split(out, "\n")
	for i, line := range lines {
		m := macLabelRe.FindStringSubmatch(strings.TrimSpace(line))
		if m == nil {
			continue
		}
		p := patch{ExternalID: m[1], Title: m[1], Source: "macos_softwareupdate", Category: "important", Severity: "moderate"}
		if i+1 < len(lines) {
			for _, kv := range strings.Split(lines[i+1], ",") {
				k, v, ok := strings.Cut(strings.TrimSpace(kv), ":")
				if !ok {
					continue
				}
				v = strings.TrimSpace(v)
				switch strings.TrimSpace(k) {
				case "Title":
					p.Title = v
				case "Version":
					p.Version = v
				case "Size":
					if n, err := strconv.ParseInt(strings.TrimSuffix(strings.TrimSuffix(v, "KiB"), "K"), 10, 64); err == nil {
						p.SizeBytes = n * 1024
					}
				case "Action":
					p.RebootRequired = strings.Contains(v, "restart")
				case "Recommended":
					if v == "YES" {
						p.Severity = "important"
					}
				}
			}
		}
		if strings.Contains(strings.ToLower(p.Title), "security") {
			p.Category = "security"
		}
		patches = append(patches, p)
	}
	return patches, nil
}

func macUpdateInstall(ctx context.Context, c *Command, ids []string, all bool) (map[string]interface{}, error) {
	args := []string{"-i"}
	if all {
		args = append(args, "-a")
	} else {
		args = append(args, ids...)
	}
	err := runProcess(ctx, c, "softwareupdate", args, nil, "", "")
	c.mu.Lock()
	out := string(c.stdout)
	c.mu.Unlock()
	reboot := strings.Contains(strings.ToLower(out), "restart")
	return map[string]interface{}{"installed": ids, "rebootRequired": reboot}, err
}

func pendingRebootHint() (bool, bool) {
	if runtime.GOOS == "linux" {
		for _, p := range []string{"/var/run/reboot-required", "/run/reboot-required"} {
			if _, err := os.Stat(p); err == nil {
				return true, true
			}
		}
		return false, true
	}
	return false, false
}
