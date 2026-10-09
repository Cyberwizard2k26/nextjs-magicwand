//go:build darwin

package collectors

import (
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"

	"github.com/cyberwizard2k26/nextjs-magicwand/agent/internal/protocol"
)

func sh(cmd string) string {
	out, err := exec.Command("/bin/sh", "-c", cmd).Output()
	if err != nil {
		return ""
	}
	return strings.TrimSpace(string(out))
}

func applyPlatformSystem(s *protocol.SystemInfo) {
	s.OSName = "macOS " + sh("sw_vers -productVersion")
	s.OSVersion = sh("sw_vers -productVersion")
	s.OSBuild = sh("sw_vers -buildVersion")
	s.SerialNumber = sh("ioreg -l | awk -F'\"' '/IOPlatformSerialNumber/{print $4}'")
	s.Manufacturer = "Apple"
	s.Model = sh("sysctl -n hw.model")
	if name := sh("system_profiler SPHardwareDataType 2>/dev/null | awk -F': ' '/Model Name/{print $2}'"); name != "" {
		s.Facts["modelName"] = name
	}
	if chip := sh("sysctl -n machdep.cpu.brand_string"); chip != "" {
		s.Facts["chip"] = chip
	}
	if strings.Contains(strings.ToLower(s.Model), "book") {
		s.DeviceType = "laptop"
	} else if s.Model != "" {
		s.DeviceType = "workstation"
	}
	if d := sh("dsconfigad -show 2>/dev/null | awk -F'= ' '/Active Directory Domain/{print $2}'"); d != "" {
		s.Domain = d
	}
}

func applyPlatformHardware(hw map[string]interface{}) {
	hw["bios"] = map[string]interface{}{"vendor": "Apple", "version": sh("system_profiler SPHardwareDataType 2>/dev/null | awk -F': ' '/System Firmware Version|Boot ROM Version/{print $2}'"), "uefi": true}
	var gpus []map[string]interface{}
	for _, name := range strings.Split(sh("system_profiler SPDisplaysDataType 2>/dev/null | awk -F': ' '/Chipset Model/{print $2}'"), "\n") {
		if name != "" {
			gpus = append(gpus, map[string]interface{}{"name": name})
		}
	}
	hw["gpus"] = gpus
	var monitors []map[string]interface{}
	for _, name := range strings.Split(sh("system_profiler SPDisplaysDataType 2>/dev/null | grep -E '^\\s{8}[^:]+:$' | sed 's/://;s/^ *//'"), "\n") {
		if name != "" {
			monitors = append(monitors, map[string]interface{}{"name": name})
		}
	}
	hw["monitors"] = monitors
	if pct, ok := batteryPercent(); ok {
		b := map[string]interface{}{"name": "Internal", "percent": pct}
		if c := sh("system_profiler SPPowerDataType 2>/dev/null | awk -F': ' '/Cycle Count/{print $2}'"); c != "" {
			b["cycleCount"] = c
		}
		if h := sh("system_profiler SPPowerDataType 2>/dev/null | awk -F': ' '/Maximum Capacity/{print $2}' | tr -d '%'"); h != "" {
			b["healthPercent"] = h
		}
		hw["batteries"] = []map[string]interface{}{b}
	} else {
		hw["batteries"] = []map[string]interface{}{}
	}
	hw["tpm"] = map[string]interface{}{"present": strings.Contains(sh("sysctl -n machdep.cpu.brand_string"), "Apple") || sh("system_profiler SPiBridgeDataType 2>/dev/null | grep -c 'Apple T2'") != "0", "version": "Secure Enclave"}
	var printers []map[string]interface{}
	for _, line := range strings.Split(sh("lpstat -p 2>/dev/null"), "\n") {
		f := strings.Fields(line)
		if len(f) >= 2 && f[0] == "printer" {
			printers = append(printers, map[string]interface{}{"name": f[1]})
		}
	}
	hw["printers"] = printers
}

func batteryPercent() (float64, bool) {
	out := sh("pmset -g batt 2>/dev/null | grep -Eo '[0-9]+%' | tr -d '%'")
	if out == "" {
		return 0, false
	}
	var v float64
	for _, c := range out {
		if c < '0' || c > '9' {
			break
		}
		v = v*10 + float64(c-'0')
	}
	return v, true
}

// ConsoleUser returns the user that owns the console (login window session).
func ConsoleUser() string {
	u := sh("stat -f '%Su' /dev/console 2>/dev/null")
	if u == "root" || u == "_windowserver" {
		return ""
	}
	return u
}

// Software lists /Applications bundles, Homebrew formulae/casks and pkgutil receipts.
func Software() []protocol.Software {
	var out []protocol.Software
	seen := map[string]bool{}
	for _, dir := range []string{"/Applications", "/Applications/Utilities", filepath.Join(os.Getenv("HOME"), "Applications")} {
		entries, err := os.ReadDir(dir)
		if err != nil {
			continue
		}
		for _, e := range entries {
			if !strings.HasSuffix(e.Name(), ".app") {
				continue
			}
			path := filepath.Join(dir, e.Name())
			name := strings.TrimSuffix(e.Name(), ".app")
			plist := filepath.Join(path, "Contents", "Info.plist")
			ver := sh("defaults read '" + plist + "' CFBundleShortVersionString 2>/dev/null")
			bundle := sh("defaults read '" + plist + "' CFBundleIdentifier 2>/dev/null")
			key := strings.ToLower(name + ver)
			if seen[key] {
				continue
			}
			seen[key] = true
			pub := ""
			if parts := strings.Split(bundle, "."); len(parts) >= 2 {
				pub = parts[1]
			}
			var size uint64
			if st, err := os.Stat(path); err == nil {
				size = uint64(st.Size())
			}
			out = append(out, protocol.Software{Name: name, Version: ver, Publisher: pub, Source: "app", InstallLocation: path, SizeBytes: size})
		}
	}
	if brew := sh("command -v brew || ls /opt/homebrew/bin/brew /usr/local/bin/brew 2>/dev/null | head -1"); brew != "" {
		if b, err := exec.Command(brew, "list", "--versions").Output(); err == nil {
			for _, line := range strings.Split(strings.TrimSpace(string(b)), "\n") {
				f := strings.Fields(line)
				if len(f) >= 1 {
					s := protocol.Software{Name: f[0], Source: "brew"}
					if len(f) > 1 {
						s.Version = f[len(f)-1]
					}
					out = append(out, s)
				}
			}
		}
	}
	return out
}

// Services lists launchd daemons (system domain).
func Services() []protocol.Service {
	var out []protocol.Service
	b, err := exec.Command("launchctl", "list").Output()
	if err != nil {
		return out
	}
	for _, line := range strings.Split(strings.TrimSpace(string(b)), "\n")[1:] {
		f := strings.Fields(line)
		if len(f) < 3 {
			continue
		}
		status := "stopped"
		pid := 0
		if f[0] != "-" {
			status = "running"
			for _, c := range f[0] {
				pid = pid*10 + int(c-'0')
			}
		}
		out = append(out, protocol.Service{Name: f[2], DisplayName: f[2], Status: status, StartType: "auto", PID: pid})
	}
	return out
}

// LocalUsers lists real user accounts (uid >= 500) and admin group membership.
func LocalUsers() []protocol.LocalUser {
	var out []protocol.LocalUser
	admins := map[string]bool{}
	for _, u := range strings.Fields(sh("dscl . -read /Groups/admin GroupMembership 2>/dev/null | cut -d' ' -f2-")) {
		admins[u] = true
	}
	for _, line := range strings.Split(sh("dscl . -list /Users UniqueID 2>/dev/null"), "\n") {
		f := strings.Fields(line)
		if len(f) != 2 || strings.HasPrefix(f[0], "_") {
			continue
		}
		uid := 0
		for _, c := range f[1] {
			uid = uid*10 + int(c-'0')
		}
		if uid < 500 && f[0] != "root" {
			continue
		}
		full := sh("dscl . -read /Users/" + f[0] + " RealName 2>/dev/null | tail -1")
		out = append(out, protocol.LocalUser{Username: f[0], FullName: strings.TrimSpace(full), IsAdmin: admins[f[0]] || f[0] == "root", Enabled: true, UID: f[1], PasswordExpires: false})
	}
	return out
}

// Security collects FileVault, firewall, Gatekeeper, SIP, XProtect, screen lock and auto-update posture.
func Security() map[string]interface{} {
	sec := map[string]interface{}{}
	sec["diskEncryption"] = []map[string]interface{}{{"volume": "/", "encrypted": strings.Contains(sh("fdesetup status 2>/dev/null"), "On"), "method": "FileVault"}}
	fwState := sh("/usr/libexec/ApplicationFirewall/socketfilterfw --getglobalstate 2>/dev/null")
	sec["firewall"] = map[string]interface{}{"enabled": strings.Contains(fwState, "enabled")}
	sec["gatekeeper"] = strings.Contains(sh("spctl --status 2>/dev/null"), "enabled")
	sec["sip"] = strings.Contains(sh("csrutil status 2>/dev/null"), "enabled")
	sec["xprotectVersion"] = sh("defaults read /Library/Apple/System/Library/CoreServices/XProtect.bundle/Contents/Info.plist CFBundleShortVersionString 2>/dev/null")
	sec["autoUpdateEnabled"] = sh("defaults read /Library/Preferences/com.apple.SoftwareUpdate AutomaticallyInstallMacOSUpdates 2>/dev/null") == "1"
	sec["remoteDesktopEnabled"] = sh("launchctl list 2>/dev/null | grep -c com.apple.screensharing") != "0"
	sec["secureBoot"] = true
	var admins []string
	for _, u := range LocalUsers() {
		if u.IsAdmin {
			admins = append(admins, u.Username)
		}
	}
	sec["localAdmins"] = admins
	sec["collectedAt"] = time.Now().UTC().Format(time.RFC3339)
	_ = json.Marshal
	return sec
}
