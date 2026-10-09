package commands

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"time"
)

// SoftwareInstall: { manager: winget|choco|apt|dnf|snap|flatpak|brew|brew_cask|msi|exe|pkg|url, package, version?, url?, args? }
func SoftwareInstall(ctx context.Context, c *Command) (interface{}, error) {
	var a struct {
		Manager string `json:"manager"`
		Package string `json:"package"`
		Version string `json:"version"`
		URL     string `json:"url"`
		Args    string `json:"args"`
		Sha256  string `json:"sha256"`
	}
	if err := c.Arg(&a); err != nil {
		return nil, err
	}
	a.Package = strings.TrimSpace(a.Package)
	if a.Manager == "" {
		a.Manager = defaultManager()
	}
	if a.Package == "" && a.URL == "" {
		return nil, errors.New("package (or url) is required")
	}
	if strings.ContainsAny(a.Package, "\n\r;|&`$") {
		return nil, errors.New("invalid package name")
	}
	var err error
	switch a.Manager {
	case "winget":
		if runtime.GOOS != "windows" {
			return nil, unsupported("winget")
		}
		args := []string{"install", "--id", a.Package, "--exact", "--silent", "--accept-package-agreements", "--accept-source-agreements", "--disable-interactivity"}
		if a.Version != "" {
			args = append(args, "--version", a.Version)
		}
		// winget is a per-user app; it is usually not on SYSTEM's PATH, so try the signed-in user first.
		if !has("winget") && consoleUser() != "" {
			err = runProcessAs(ctx, c, "user", "winget", args)
		} else {
			err = runProcess(ctx, c, "winget", args, nil, "", "")
		}
	case "choco":
		if runtime.GOOS != "windows" {
			return nil, unsupported("Chocolatey")
		}
		args := []string{"install", a.Package, "-y", "--no-progress"}
		if a.Version != "" {
			args = append(args, "--version", a.Version)
		}
		err = runProcess(ctx, c, "choco", args, nil, "", "")
	case "apt":
		pkg := a.Package
		if a.Version != "" {
			pkg += "=" + a.Version
		}
		if _, uerr := runOut(ctx, "apt-get", "update", "-qq"); uerr != nil {
			c.Emit("stderr", []byte(uerr.Error()+"\n"))
		}
		err = runProcess(ctx, c, "apt-get", []string{"install", "-y", pkg}, []string{"DEBIAN_FRONTEND=noninteractive"}, "", "")
	case "dnf", "yum":
		pkg := a.Package
		if a.Version != "" {
			pkg += "-" + a.Version
		}
		err = runProcess(ctx, c, a.Manager, []string{"install", "-y", pkg}, nil, "", "")
	case "snap":
		err = runProcess(ctx, c, "snap", []string{"install", a.Package}, nil, "", "")
	case "flatpak":
		err = runProcess(ctx, c, "flatpak", []string{"install", "-y", "--noninteractive", a.Package}, nil, "", "")
	case "brew", "brew_cask":
		if runtime.GOOS != "darwin" {
			return nil, unsupported("Homebrew")
		}
		args := []string{"install"}
		if a.Manager == "brew_cask" {
			args = append(args, "--cask")
		}
		args = append(args, a.Package)
		// brew refuses to run as root: run as the console user.
		err = runProcessAs(ctx, c, "user", brewPath(), args)
	case "msi", "exe", "pkg", "url":
		if a.URL == "" {
			return nil, errors.New("url is required for installer downloads")
		}
		file, derr := downloadTo(ctx, c, a.URL, a.Sha256)
		if derr != nil {
			return nil, derr
		}
		defer os.Remove(file)
		switch {
		case strings.HasSuffix(strings.ToLower(file), ".msi"):
			args := []string{"/i", file, "/qn", "/norestart"}
			if a.Args != "" {
				args = append(args, strings.Fields(a.Args)...)
			}
			err = runProcess(ctx, c, "msiexec.exe", args, nil, "", "")
		case strings.HasSuffix(strings.ToLower(file), ".pkg"):
			err = runProcess(ctx, c, "installer", []string{"-pkg", file, "-target", "/"}, nil, "", "")
		case strings.HasSuffix(strings.ToLower(file), ".deb"):
			err = runProcess(ctx, c, "apt-get", []string{"install", "-y", file}, []string{"DEBIAN_FRONTEND=noninteractive"}, "", "")
		case strings.HasSuffix(strings.ToLower(file), ".rpm"):
			err = runProcess(ctx, c, "rpm", []string{"-Uvh", file}, nil, "", "")
		default:
			args := strings.Fields(a.Args)
			if len(args) == 0 && runtime.GOOS == "windows" {
				args = []string{"/S", "/silent", "/quiet", "/norestart"}
			}
			if runtime.GOOS != "windows" {
				_ = os.Chmod(file, 0o755)
			}
			err = runProcess(ctx, c, file, args, nil, "", "")
		}
	default:
		return nil, fmt.Errorf("unknown package manager %q", a.Manager)
	}
	if err != nil {
		return nil, err
	}
	if c.exit != nil && *c.exit != 0 {
		return nil, fmt.Errorf("installer exited with code %d", *c.exit)
	}
	return map[string]interface{}{"installed": a.Package, "manager": a.Manager}, nil
}

// SoftwareUninstall: { name, manager?, package?, uninstallString?, installLocation? }
func SoftwareUninstall(ctx context.Context, c *Command) (interface{}, error) {
	var a struct {
		Name            string `json:"name"`
		Manager         string `json:"manager"`
		Package         string `json:"package"`
		UninstallString string `json:"uninstallString"`
		InstallLocation string `json:"installLocation"`
	}
	if err := c.Arg(&a); err != nil {
		return nil, err
	}
	pkg := a.Package
	if pkg == "" {
		pkg = a.Name
	}
	if pkg == "" && a.UninstallString == "" {
		return nil, errors.New("name or uninstallString is required")
	}
	var err error
	switch runtime.GOOS {
	case "windows":
		switch {
		case a.UninstallString != "":
			cmdline := a.UninstallString
			lower := strings.ToLower(cmdline)
			if strings.Contains(lower, "msiexec") {
				cmdline = strings.NewReplacer("/I", "/X", "/i", "/x").Replace(cmdline)
				if !strings.Contains(lower, "/q") {
					cmdline += " /qn /norestart"
				}
			} else if !strings.Contains(lower, "/s") && !strings.Contains(lower, "/quiet") && !strings.Contains(lower, "--silent") {
				cmdline += " /S"
			}
			c.Emit("stdout", []byte("> "+cmdline+"\n"))
			err = runProcess(ctx, c, "cmd.exe", []string{"/c", cmdline}, nil, "", "")
		case a.Manager == "choco":
			err = runProcess(ctx, c, "choco", []string{"uninstall", pkg, "-y"}, nil, "", "")
		default:
			args := []string{"uninstall", "--id", pkg, "--silent", "--accept-source-agreements", "--disable-interactivity"}
			if !has("winget") && consoleUser() != "" {
				err = runProcessAs(ctx, c, "user", "winget", args)
			} else {
				err = runProcess(ctx, c, "winget", args, nil, "", "")
			}
		}
	case "darwin":
		switch {
		case a.Manager == "brew" || a.Manager == "brew_cask":
			args := []string{"uninstall"}
			if a.Manager == "brew_cask" {
				args = append(args, "--cask")
			}
			err = runProcessAs(ctx, c, "user", brewPath(), append(args, pkg))
		case strings.HasSuffix(a.InstallLocation, ".app") && strings.HasPrefix(a.InstallLocation, "/Applications/"):
			c.Emit("stdout", []byte("Removing "+a.InstallLocation+"\n"))
			err = os.RemoveAll(a.InstallLocation)
		default:
			return nil, errors.New("this app has no uninstaller the agent can drive (not from Homebrew and not in /Applications)")
		}
	default:
		switch {
		case a.Manager == "snap":
			err = runProcess(ctx, c, "snap", []string{"remove", pkg}, nil, "", "")
		case a.Manager == "flatpak":
			err = runProcess(ctx, c, "flatpak", []string{"uninstall", "-y", "--noninteractive", pkg}, nil, "", "")
		case has("apt-get"):
			err = runProcess(ctx, c, "apt-get", []string{"remove", "-y", pkg}, []string{"DEBIAN_FRONTEND=noninteractive"}, "", "")
		case has("dnf"):
			err = runProcess(ctx, c, "dnf", []string{"remove", "-y", pkg}, nil, "", "")
		case has("yum"):
			err = runProcess(ctx, c, "yum", []string{"remove", "-y", pkg}, nil, "", "")
		case has("zypper"):
			err = runProcess(ctx, c, "zypper", []string{"--non-interactive", "remove", pkg}, nil, "", "")
		default:
			return nil, errors.New("no supported package manager found")
		}
	}
	if err != nil {
		return nil, err
	}
	if c.exit != nil && *c.exit != 0 {
		return nil, fmt.Errorf("uninstaller exited with code %d", *c.exit)
	}
	return map[string]interface{}{"removed": pkg}, nil
}

func defaultManager() string {
	switch runtime.GOOS {
	case "windows":
		if has("choco") {
			return "choco"
		}
		return "winget"
	case "darwin":
		return "brew"
	default:
		switch {
		case has("apt-get"):
			return "apt"
		case has("dnf"):
			return "dnf"
		case has("yum"):
			return "yum"
		}
		return "apt"
	}
}

func brewPath() string {
	for _, p := range []string{"/opt/homebrew/bin/brew", "/usr/local/bin/brew"} {
		if _, err := os.Stat(p); err == nil {
			return p
		}
	}
	return "brew"
}

// runProcessAs runs a program in the interactive user's context, streaming output like runProcess.
func runProcessAs(ctx context.Context, c *Command, runAs string, name string, args []string) error {
	saved := c.RunAs
	c.RunAs = runAs
	defer func() { c.RunAs = saved }()
	return runProcess(ctx, c, name, args, nil, "", "")
}

// downloadTo fetches an installer to a temp file (optionally verifying its SHA-256) and returns the path.
func downloadTo(ctx context.Context, c *Command, url, sha string) (string, error) {
	if !strings.HasPrefix(url, "https://") && !strings.HasPrefix(url, "http://") {
		return "", errors.New("url must be http(s)")
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return "", err
	}
	client := &http.Client{Timeout: 30 * time.Minute}
	resp, err := client.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		return "", fmt.Errorf("download failed: HTTP %d", resp.StatusCode)
	}
	name := filepath.Base(strings.SplitN(url, "?", 2)[0])
	if name == "" || name == "/" || name == "." {
		name = "installer"
	}
	dir, err := os.MkdirTemp("", "mw-install-")
	if err != nil {
		return "", err
	}
	path := filepath.Join(dir, name)
	f, err := os.Create(path)
	if err != nil {
		return "", err
	}
	n, err := io.Copy(f, resp.Body)
	f.Close()
	if err != nil {
		return "", err
	}
	c.Emit("stdout", []byte(fmt.Sprintf("Downloaded %s (%d bytes)\n", name, n)))
	if sha != "" {
		r, err := FileHash(ctx, &Command{Args: []byte(`{"path":` + jsonString(path) + `}`)})
		if err != nil {
			return "", err
		}
		if got := r.(map[string]interface{})["sha256"]; !strings.EqualFold(fmt.Sprint(got), sha) {
			return "", fmt.Errorf("checksum mismatch: expected %s got %s", sha, got)
		}
	}
	return path, nil
}

func jsonString(s string) string {
	b, _ := jsonMarshal(s)
	return string(b)
}
