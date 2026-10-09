//go:build linux

package collectors

import (
	"bufio"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/cyberwizard2k26/nextjs-magicwand/agent/internal/protocol"
)

func readDMI(name string) string {
	b, err := os.ReadFile(filepath.Join("/sys/class/dmi/id", name))
	if err != nil {
		return ""
	}
	return strings.TrimSpace(string(b))
}

func applyPlatformSystem(s *protocol.SystemInfo) {
	s.SerialNumber = readDMI("product_serial")
	s.Manufacturer = readDMI("sys_vendor")
	s.Model = readDMI("product_name")
	if b, err := os.ReadFile("/etc/os-release"); err == nil {
		for _, line := range strings.Split(string(b), "\n") {
			if strings.HasPrefix(line, "PRETTY_NAME=") {
				s.OSName = strings.Trim(strings.TrimPrefix(line, "PRETTY_NAME="), `"`)
			}
			if strings.HasPrefix(line, "VERSION_ID=") {
				s.OSVersion = strings.Trim(strings.TrimPrefix(line, "VERSION_ID="), `"`)
			}
		}
	}
	if chassis := readDMI("chassis_type"); chassis != "" {
		switch chassis {
		case "8", "9", "10", "14", "31", "32":
			s.DeviceType = "laptop"
		case "17", "23", "28":
			s.DeviceType = "server"
		case "3", "4", "6", "7", "13", "15", "16", "35":
			s.DeviceType = "workstation"
		}
	}
}

func applyPlatformHardware(hw map[string]interface{}) {
	hw["bios"] = map[string]interface{}{"vendor": readDMI("bios_vendor"), "version": readDMI("bios_version"), "releaseDate": readDMI("bios_date"), "uefi": fileExists("/sys/firmware/efi")}
	hw["baseboard"] = map[string]interface{}{"manufacturer": readDMI("board_vendor"), "product": readDMI("board_name"), "serial": readDMI("board_serial"), "version": readDMI("board_version")}
	hw["chassis"] = map[string]interface{}{"manufacturer": readDMI("chassis_vendor"), "serial": readDMI("chassis_serial"), "assetTag": readDMI("chassis_asset_tag"), "type": readDMI("chassis_type")}
	var gpus []map[string]interface{}
	if out, err := exec.Command("sh", "-c", "lspci 2>/dev/null | grep -iE 'vga|3d|display'").Output(); err == nil {
		for _, line := range strings.Split(strings.TrimSpace(string(out)), "\n") {
			if i := strings.Index(line, ": "); i > 0 && line != "" {
				gpus = append(gpus, map[string]interface{}{"name": strings.TrimSpace(line[i+2:])})
			}
		}
	}
	if gpus == nil {
		gpus = []map[string]interface{}{}
	}
	hw["gpus"] = gpus
	var batteries []map[string]interface{}
	if entries, err := os.ReadDir("/sys/class/power_supply"); err == nil {
		for _, e := range entries {
			if !strings.HasPrefix(e.Name(), "BAT") {
				continue
			}
			base := filepath.Join("/sys/class/power_supply", e.Name())
			b := map[string]interface{}{"name": e.Name()}
			if v := readFileInt(filepath.Join(base, "capacity")); v >= 0 {
				b["percent"] = v
			}
			if s, err := os.ReadFile(filepath.Join(base, "status")); err == nil {
				b["status"] = strings.TrimSpace(string(s))
			}
			if c := readFileInt(filepath.Join(base, "cycle_count")); c >= 0 {
				b["cycleCount"] = c
			}
			full := readFileInt(filepath.Join(base, "energy_full"))
			design := readFileInt(filepath.Join(base, "energy_full_design"))
			if full <= 0 {
				full = readFileInt(filepath.Join(base, "charge_full"))
				design = readFileInt(filepath.Join(base, "charge_full_design"))
			}
			if full > 0 && design > 0 {
				b["healthPercent"] = int(float64(full) / float64(design) * 100)
			}
			batteries = append(batteries, b)
		}
	}
	if batteries == nil {
		batteries = []map[string]interface{}{}
	}
	hw["batteries"] = batteries
	hw["tpm"] = map[string]interface{}{"present": fileExists("/dev/tpm0") || fileExists("/dev/tpmrm0")}
}

func fileExists(p string) bool { _, err := os.Stat(p); return err == nil }

func readFileInt(p string) int {
	b, err := os.ReadFile(p)
	if err != nil {
		return -1
	}
	v, err := strconv.Atoi(strings.TrimSpace(string(b)))
	if err != nil {
		return -1
	}
	return v
}

func batteryPercent() (float64, bool) {
	entries, err := os.ReadDir("/sys/class/power_supply")
	if err != nil {
		return 0, false
	}
	for _, e := range entries {
		if strings.HasPrefix(e.Name(), "BAT") {
			if v := readFileInt(filepath.Join("/sys/class/power_supply", e.Name(), "capacity")); v >= 0 {
				return float64(v), true
			}
		}
	}
	return 0, false
}

// ConsoleUser returns the user owning the active graphical session (or the first logged-in user).
func ConsoleUser() string {
	if out, err := exec.Command("sh", "-c", "loginctl list-sessions --no-legend 2>/dev/null | awk '{print $3}' | grep -v '^$' | head -1").Output(); err == nil {
		if u := strings.TrimSpace(string(out)); u != "" && u != "root" {
			return u
		}
	}
	if out, err := exec.Command("sh", "-c", "who 2>/dev/null | awk '{print $1}' | head -1").Output(); err == nil {
		return strings.TrimSpace(string(out))
	}
	return ""
}

// Software lists installed packages (dpkg, rpm, snap, flatpak).
func Software() []protocol.Software {
	var out []protocol.Software
	if b, err := exec.Command("sh", "-c", `dpkg-query -W -f='${Package}\t${Version}\t${Maintainer}\t${Installed-Size}\n' 2>/dev/null`).Output(); err == nil {
		sc := bufio.NewScanner(strings.NewReader(string(b)))
		for sc.Scan() {
			p := strings.Split(sc.Text(), "\t")
			if len(p) >= 2 && p[0] != "" {
				sz, _ := strconv.ParseUint(strings.TrimSpace(p[3]), 10, 64)
				out = append(out, protocol.Software{Name: p[0], Version: p[1], Publisher: p[2], Source: "apt", SizeBytes: sz * 1024})
			}
		}
	}
	if len(out) == 0 {
		if b, err := exec.Command("sh", "-c", `rpm -qa --qf '%{NAME}\t%{VERSION}-%{RELEASE}\t%{VENDOR}\t%{SIZE}\t%{INSTALLTIME:date}\n' 2>/dev/null`).Output(); err == nil {
			sc := bufio.NewScanner(strings.NewReader(string(b)))
			for sc.Scan() {
				p := strings.Split(sc.Text(), "\t")
				if len(p) >= 2 {
					sz, _ := strconv.ParseUint(strings.TrimSpace(p[3]), 10, 64)
					out = append(out, protocol.Software{Name: p[0], Version: p[1], Publisher: p[2], Source: "rpm", SizeBytes: sz, InstallDate: p[4]})
				}
			}
		}
	}
	if b, err := exec.Command("sh", "-c", "snap list 2>/dev/null | tail -n +2").Output(); err == nil {
		for _, line := range strings.Split(strings.TrimSpace(string(b)), "\n") {
			f := strings.Fields(line)
			if len(f) >= 2 {
				pub := ""
				if len(f) >= 5 {
					pub = f[4]
				}
				out = append(out, protocol.Software{Name: f[0], Version: f[1], Publisher: pub, Source: "snap"})
			}
		}
	}
	if b, err := exec.Command("sh", "-c", "flatpak list --app --columns=application,version,name 2>/dev/null").Output(); err == nil {
		for _, line := range strings.Split(strings.TrimSpace(string(b)), "\n") {
			f := strings.Split(line, "\t")
			if len(f) >= 1 && f[0] != "" {
				s := protocol.Software{Name: f[0], Source: "flatpak"}
				if len(f) > 1 {
					s.Version = f[1]
				}
				if len(f) > 2 && f[2] != "" {
					s.Name = f[2]
				}
				out = append(out, s)
			}
		}
	}
	return out
}

// Services lists systemd units of type service.
func Services() []protocol.Service {
	var out []protocol.Service
	b, err := exec.Command("systemctl", "list-units", "--type=service", "--all", "--no-legend", "--no-pager", "--plain").Output()
	if err != nil {
		return out
	}
	enabled := map[string]string{}
	if eb, err := exec.Command("systemctl", "list-unit-files", "--type=service", "--no-legend", "--no-pager", "--plain").Output(); err == nil {
		for _, line := range strings.Split(string(eb), "\n") {
			f := strings.Fields(line)
			if len(f) >= 2 {
				enabled[f[0]] = f[1]
			}
		}
	}
	for _, line := range strings.Split(strings.TrimSpace(string(b)), "\n") {
		f := strings.Fields(line)
		if len(f) < 4 {
			continue
		}
		name := strings.TrimSuffix(f[0], ".service")
		status := "stopped"
		switch f[3] {
		case "running":
			status = "running"
		case "exited", "dead", "failed":
			status = "stopped"
		case "start", "auto-restart":
			status = "starting"
		}
		st := "manual"
		switch enabled[f[0]] {
		case "enabled", "enabled-runtime", "alias", "indirect":
			st = "auto"
		case "disabled":
			st = "manual"
		case "masked", "masked-runtime":
			st = "disabled"
		case "static":
			st = "manual"
		}
		desc := ""
		if len(f) > 4 {
			desc = strings.Join(f[4:], " ")
		}
		out = append(out, protocol.Service{Name: name, DisplayName: name, Status: status, StartType: st, Description: desc})
	}
	return out
}

// LocalUsers lists human accounts (uid >= 1000 or root) from /etc/passwd with admin = sudo/wheel membership.
func LocalUsers() []protocol.LocalUser {
	var out []protocol.LocalUser
	admins := map[string]bool{}
	if b, err := os.ReadFile("/etc/group"); err == nil {
		for _, line := range strings.Split(string(b), "\n") {
			f := strings.Split(line, ":")
			if len(f) >= 4 && (f[0] == "sudo" || f[0] == "wheel" || f[0] == "admin") {
				for _, u := range strings.Split(f[3], ",") {
					if u != "" {
						admins[u] = true
					}
				}
			}
		}
	}
	b, err := os.ReadFile("/etc/passwd")
	if err != nil {
		return out
	}
	for _, line := range strings.Split(string(b), "\n") {
		f := strings.Split(line, ":")
		if len(f) < 7 {
			continue
		}
		uid, _ := strconv.Atoi(f[2])
		if uid != 0 && (uid < 1000 || uid >= 65534) {
			continue
		}
		shell := f[6]
		enabled := !strings.HasSuffix(shell, "nologin") && !strings.HasSuffix(shell, "false")
		out = append(out, protocol.LocalUser{Username: f[0], FullName: strings.Split(f[4], ",")[0], IsAdmin: uid == 0 || admins[f[0]], Enabled: enabled, UID: f[2], PasswordExpires: true})
	}
	return out
}

// Security gathers posture facts: firewall, disk encryption, ssh root login, auto updates, secure boot.
func Security() map[string]interface{} {
	sec := map[string]interface{}{}
	fw := map[string]interface{}{"enabled": false}
	if out, err := exec.Command("sh", "-c", "ufw status 2>/dev/null | head -1").Output(); err == nil && strings.Contains(string(out), "active") && !strings.Contains(string(out), "inactive") {
		fw["enabled"] = true
		fw["profiles"] = map[string]bool{"ufw": true}
	} else if out, err := exec.Command("sh", "-c", "firewall-cmd --state 2>/dev/null").Output(); err == nil && strings.TrimSpace(string(out)) == "running" {
		fw["enabled"] = true
		fw["profiles"] = map[string]bool{"firewalld": true}
	} else if out, err := exec.Command("sh", "-c", "nft list ruleset 2>/dev/null | wc -l").Output(); err == nil {
		if n, _ := strconv.Atoi(strings.TrimSpace(string(out))); n > 5 {
			fw["enabled"] = true
			fw["profiles"] = map[string]bool{"nftables": true}
		}
	}
	sec["firewall"] = fw
	var enc []map[string]interface{}
	if out, err := exec.Command("sh", "-c", "lsblk -rno NAME,TYPE,MOUNTPOINT 2>/dev/null").Output(); err == nil {
		for _, line := range strings.Split(strings.TrimSpace(string(out)), "\n") {
			f := strings.Fields(line)
			if len(f) >= 2 && f[1] == "crypt" {
				mp := ""
				if len(f) > 2 {
					mp = f[2]
				}
				enc = append(enc, map[string]interface{}{"volume": f[0], "encrypted": true, "method": "LUKS", "mount": mp})
			}
		}
	}
	if len(enc) == 0 {
		enc = append(enc, map[string]interface{}{"volume": "/", "encrypted": false})
	}
	sec["diskEncryption"] = enc
	if b, err := os.ReadFile("/etc/ssh/sshd_config"); err == nil {
		sec["sshRootLogin"] = strings.Contains(string(b), "\nPermitRootLogin yes")
	}
	sec["autoUpdateEnabled"] = fileExists("/etc/apt/apt.conf.d/20auto-upgrades") || fileExists("/etc/dnf/automatic.conf")
	if out, err := exec.Command("sh", "-c", "mokutil --sb-state 2>/dev/null").Output(); err == nil {
		sec["secureBoot"] = strings.Contains(string(out), "enabled")
	}
	sec["tpmEnabled"] = fileExists("/dev/tpm0")
	var admins []string
	for _, u := range LocalUsers() {
		if u.IsAdmin {
			admins = append(admins, u.Username)
		}
	}
	sec["localAdmins"] = admins
	sec["collectedAt"] = time.Now().UTC().Format(time.RFC3339)
	return sec
}
