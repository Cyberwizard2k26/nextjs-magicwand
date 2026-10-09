//go:build windows

package collectors

import (
	"encoding/json"
	"os/exec"
	"strings"
	"syscall"
	"time"

	"golang.org/x/sys/windows/registry"

	"github.com/cyberwizard2k26/nextjs-magicwand/agent/internal/protocol"
)

func ps(script string) ([]byte, error) {
	cmd := exec.Command("powershell.exe", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script)
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
	return cmd.Output()
}

func psJSON(script string, v interface{}) error {
	out, err := ps("[Console]::OutputEncoding=[Text.Encoding]::UTF8; " + script + " | ConvertTo-Json -Depth 4 -Compress")
	if err != nil {
		return err
	}
	s := strings.TrimSpace(string(out))
	if s == "" {
		return nil
	}
	if !strings.HasPrefix(s, "[") {
		s = "[" + s + "]"
	}
	return json.Unmarshal([]byte(s), v)
}

func applyPlatformSystem(s *protocol.SystemInfo) {
	var rows []struct {
		Caption, Version, BuildNumber, Manufacturer, Model, SerialNumber, Domain, CSName string
		PartOfDomain                                                                        bool
		PCSystemType                                                                        int
	}
	_ = psJSON(`$os=Get-CimInstance Win32_OperatingSystem; $cs=Get-CimInstance Win32_ComputerSystem; $b=Get-CimInstance Win32_BIOS; [pscustomobject]@{Caption=$os.Caption;Version=$os.Version;BuildNumber=$os.BuildNumber;Manufacturer=$cs.Manufacturer;Model=$cs.Model;SerialNumber=$b.SerialNumber;Domain=$cs.Domain;CSName=$cs.Name;PartOfDomain=$cs.PartOfDomain;PCSystemType=$cs.PCSystemType}`, &rows)
	if len(rows) > 0 {
		r := rows[0]
		s.OSName = strings.TrimSpace(r.Caption)
		s.OSVersion = r.Version
		s.OSBuild = r.BuildNumber
		s.Manufacturer = r.Manufacturer
		s.Model = r.Model
		s.SerialNumber = r.SerialNumber
		if r.PartOfDomain {
			s.Domain = r.Domain
		}
		switch r.PCSystemType {
		case 2:
			s.DeviceType = "laptop"
		case 4, 5:
			s.DeviceType = "server"
		case 1, 3:
			s.DeviceType = "workstation"
		}
		if strings.Contains(strings.ToLower(r.Caption), "server") {
			s.DeviceType = "server"
		}
	}
	if k, err := registry.OpenKey(registry.LOCAL_MACHINE, `SOFTWARE\Microsoft\Windows NT\CurrentVersion`, registry.QUERY_VALUE); err == nil {
		if ubr, _, err := k.GetIntegerValue("UBR"); err == nil && s.OSBuild != "" {
			s.OSBuild = s.OSBuild + "." + itoa(int(ubr))
		}
		if dv, _, err := k.GetStringValue("DisplayVersion"); err == nil {
			s.Facts["displayVersion"] = dv
		}
		k.Close()
	}
}

func itoa(i int) string {
	if i == 0 {
		return "0"
	}
	var b []byte
	for i > 0 {
		b = append([]byte{byte('0' + i%10)}, b...)
		i /= 10
	}
	return string(b)
}

func applyPlatformHardware(hw map[string]interface{}) {
	var bios []struct{ Manufacturer, SMBIOSBIOSVersion, ReleaseDate string }
	_ = psJSON(`Get-CimInstance Win32_BIOS | Select-Object Manufacturer,SMBIOSBIOSVersion,@{n='ReleaseDate';e={$_.ReleaseDate.ToString('yyyy-MM-dd')}}`, &bios)
	uefi := false
	if out, err := ps(`$env:firmware_type; (Get-ItemProperty -Path 'HKLM:\System\CurrentControlSet\Control' -Name PEFirmwareType -ErrorAction SilentlyContinue).PEFirmwareType`); err == nil && strings.Contains(string(out), "2") {
		uefi = true
	}
	secureBoot := false
	if out, err := ps(`try { Confirm-SecureBootUEFI } catch { 'False' }`); err == nil && strings.Contains(string(out), "True") {
		secureBoot = true
	}
	if len(bios) > 0 {
		hw["bios"] = map[string]interface{}{"vendor": bios[0].Manufacturer, "version": bios[0].SMBIOSBIOSVersion, "releaseDate": bios[0].ReleaseDate, "uefi": uefi, "secureBoot": secureBoot}
	}
	var bb []struct{ Manufacturer, Product, SerialNumber, Version string }
	_ = psJSON(`Get-CimInstance Win32_BaseBoard | Select-Object Manufacturer,Product,SerialNumber,Version`, &bb)
	if len(bb) > 0 {
		hw["baseboard"] = map[string]interface{}{"manufacturer": bb[0].Manufacturer, "product": bb[0].Product, "serial": bb[0].SerialNumber, "version": bb[0].Version}
	}
	var gpus []struct {
		Name, DriverVersion string
		AdapterRAM          uint64
	}
	_ = psJSON(`Get-CimInstance Win32_VideoController | Select-Object Name,DriverVersion,AdapterRAM`, &gpus)
	var g []map[string]interface{}
	for _, x := range gpus {
		g = append(g, map[string]interface{}{"name": x.Name, "driverVersion": x.DriverVersion, "memoryBytes": x.AdapterRAM})
	}
	hw["gpus"] = g
	var mems []struct {
		DeviceLocator, Manufacturer, PartNumber string
		Capacity                                uint64
		Speed                                   int
	}
	_ = psJSON(`Get-CimInstance Win32_PhysicalMemory | Select-Object DeviceLocator,Manufacturer,PartNumber,Capacity,Speed`, &mems)
	if m, ok := hw["memory"].(map[string]interface{}); ok {
		var slots []map[string]interface{}
		for _, x := range mems {
			slots = append(slots, map[string]interface{}{"slot": x.DeviceLocator, "sizeBytes": x.Capacity, "speedMhz": x.Speed, "manufacturer": strings.TrimSpace(x.Manufacturer), "partNumber": strings.TrimSpace(x.PartNumber)})
		}
		m["slots"] = slots
	}
	var pd []struct {
		Model, SerialNumber, MediaType, BusType string
		Size                                    uint64
	}
	_ = psJSON(`Get-PhysicalDisk | Select-Object @{n='Model';e={$_.FriendlyName}},SerialNumber,MediaType,BusType,Size`, &pd)
	if len(pd) > 0 {
		var disks []map[string]interface{}
		for _, x := range pd {
			t := "unknown"
			switch strings.ToLower(x.MediaType) {
			case "ssd":
				t = "ssd"
				if strings.EqualFold(x.BusType, "NVMe") {
					t = "nvme"
				}
			case "hdd":
				t = "hdd"
			}
			disks = append(disks, map[string]interface{}{"name": x.Model, "model": x.Model, "serial": strings.TrimSpace(x.SerialNumber), "sizeBytes": x.Size, "type": t, "interface": x.BusType, "partitions": []map[string]interface{}{}})
		}
		// Partition/usage information came from gopsutil (keyed by drive letter); attach it to the first physical disk.
		var allParts []map[string]interface{}
		if existing, ok := hw["disks"].([]map[string]interface{}); ok {
			for _, e := range existing {
				if parts, ok := e["partitions"].([]map[string]interface{}); ok {
					allParts = append(allParts, parts...)
				}
			}
		}
		if len(disks) > 0 {
			disks[0]["partitions"] = allParts
		}
		hw["disks"] = disks
	}
	var mons []struct {
		Name, Serial string
	}
	_ = psJSON(`Get-CimInstance -Namespace root\wmi WmiMonitorID -ErrorAction SilentlyContinue | ForEach-Object { [pscustomobject]@{Name=(($_.UserFriendlyName | Where-Object {$_ -ne 0} | ForEach-Object {[char]$_}) -join '');Serial=(($_.SerialNumberID | Where-Object {$_ -ne 0} | ForEach-Object {[char]$_}) -join '')} }`, &mons)
	var ms []map[string]interface{}
	for _, m := range mons {
		ms = append(ms, map[string]interface{}{"name": m.Name, "serial": m.Serial})
	}
	hw["monitors"] = ms
	var bats []struct {
		EstimatedChargeRemaining int
		BatteryStatus            int
		Name                     string
	}
	_ = psJSON(`Get-CimInstance Win32_Battery | Select-Object EstimatedChargeRemaining,BatteryStatus,Name`, &bats)
	var b []map[string]interface{}
	for _, x := range bats {
		b = append(b, map[string]interface{}{"name": x.Name, "percent": x.EstimatedChargeRemaining, "status": map[int]string{1: "discharging", 2: "ac", 3: "full", 4: "low", 5: "critical", 6: "charging"}[x.BatteryStatus]})
	}
	hw["batteries"] = b
	var tpm []struct{ TpmPresent, TpmReady, TpmEnabled bool }
	_ = psJSON(`try { Get-Tpm | Select-Object TpmPresent,TpmReady,TpmEnabled } catch { [pscustomobject]@{TpmPresent=$false;TpmReady=$false;TpmEnabled=$false} }`, &tpm)
	if len(tpm) > 0 {
		hw["tpm"] = map[string]interface{}{"present": tpm[0].TpmPresent, "enabled": tpm[0].TpmEnabled, "owned": tpm[0].TpmReady}
	}
	var printers []struct {
		Name, DriverName, PortName string
		Default                    bool
		PrinterStatus              int
	}
	_ = psJSON(`Get-CimInstance Win32_Printer | Select-Object Name,DriverName,PortName,Default,PrinterStatus`, &printers)
	var pr []map[string]interface{}
	for _, p := range printers {
		pr = append(pr, map[string]interface{}{"name": p.Name, "driver": p.DriverName, "port": p.PortName, "default": p.Default})
	}
	hw["printers"] = pr
}

func batteryPercent() (float64, bool) {
	var bats []struct{ EstimatedChargeRemaining int }
	if err := psJSON(`Get-CimInstance Win32_Battery | Select-Object EstimatedChargeRemaining`, &bats); err != nil || len(bats) == 0 {
		return 0, false
	}
	return float64(bats[0].EstimatedChargeRemaining), true
}

// ConsoleUser returns the interactive (console) user, e.g. DOMAIN\user.
func ConsoleUser() string {
	out, err := ps(`(Get-CimInstance Win32_ComputerSystem).UserName`)
	if err != nil {
		return ""
	}
	return strings.TrimSpace(string(out))
}

// Software reads the Uninstall registry keys (64-bit, 32-bit and per-user hives) plus Store apps.
func Software() []protocol.Software {
	var out []protocol.Software
	seen := map[string]bool{}
	read := func(root registry.Key, path, source string) {
		k, err := registry.OpenKey(root, path, registry.ENUMERATE_SUB_KEYS|registry.QUERY_VALUE)
		if err != nil {
			return
		}
		defer k.Close()
		names, _ := k.ReadSubKeyNames(-1)
		for _, n := range names {
			sk, err := registry.OpenKey(root, path+`\`+n, registry.QUERY_VALUE)
			if err != nil {
				continue
			}
			name, _, _ := sk.GetStringValue("DisplayName")
			if name == "" {
				sk.Close()
				continue
			}
			sysComp, _, _ := sk.GetIntegerValue("SystemComponent")
			ver, _, _ := sk.GetStringValue("DisplayVersion")
			pub, _, _ := sk.GetStringValue("Publisher")
			date, _, _ := sk.GetStringValue("InstallDate")
			loc, _, _ := sk.GetStringValue("InstallLocation")
			unin, _, _ := sk.GetStringValue("UninstallString")
			size, _, _ := sk.GetIntegerValue("EstimatedSize")
			sk.Close()
			key := strings.ToLower(name + "|" + ver)
			if seen[key] {
				continue
			}
			seen[key] = true
			src := source
			if strings.Contains(strings.ToLower(unin), "msiexec") {
				src = "msi"
			}
			if len(date) == 8 {
				date = date[:4] + "-" + date[4:6] + "-" + date[6:]
			}
			out = append(out, protocol.Software{Name: name, Version: ver, Publisher: pub, InstallDate: date, Source: src, SizeBytes: size * 1024, InstallLocation: loc, UninstallString: unin, IsSystemComponent: sysComp == 1})
		}
	}
	read(registry.LOCAL_MACHINE, `SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall`, "exe")
	read(registry.LOCAL_MACHINE, `SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall`, "exe")
	read(registry.CURRENT_USER, `SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall`, "exe")
	var store []struct{ Name, Version, Publisher, InstallLocation string }
	_ = psJSON(`Get-AppxPackage -AllUsers -ErrorAction SilentlyContinue | Where-Object { -not $_.IsFramework -and $_.SignatureKind -eq 'Store' } | Select-Object Name,Version,Publisher,InstallLocation`, &store)
	for _, s := range store {
		pub := s.Publisher
		if i := strings.Index(pub, "CN="); i >= 0 {
			pub = strings.Split(pub[i+3:], ",")[0]
		}
		out = append(out, protocol.Software{Name: s.Name, Version: s.Version, Publisher: pub, Source: "store", InstallLocation: s.InstallLocation})
	}
	return out
}

// Services lists Win32 services.
func Services() []protocol.Service {
	var rows []struct {
		Name, DisplayName, State, StartMode, StartName, PathName, Description string
		ProcessId                                                              int
	}
	_ = psJSON(`Get-CimInstance Win32_Service | Select-Object Name,DisplayName,State,StartMode,StartName,PathName,Description,ProcessId`, &rows)
	var out []protocol.Service
	for _, r := range rows {
		st := "unknown"
		switch r.State {
		case "Running":
			st = "running"
		case "Stopped":
			st = "stopped"
		case "Paused":
			st = "paused"
		case "Start Pending":
			st = "starting"
		case "Stop Pending":
			st = "stopping"
		}
		mode := "unknown"
		switch r.StartMode {
		case "Auto":
			mode = "auto"
		case "Manual":
			mode = "manual"
		case "Disabled":
			mode = "disabled"
		}
		out = append(out, protocol.Service{Name: r.Name, DisplayName: r.DisplayName, Status: st, StartType: mode, Account: r.StartName, PID: r.ProcessId, Path: r.PathName, Description: r.Description})
	}
	return out
}

// LocalUsers lists local accounts and whether they belong to Administrators.
func LocalUsers() []protocol.LocalUser {
	var rows []struct {
		Name, FullName, SID string
		Enabled, PasswordExpires bool
		LastLogon            string
		IsAdmin              bool
	}
	_ = psJSON(`$admins = @(); try { $admins = (Get-LocalGroupMember -Group 'Administrators' -ErrorAction SilentlyContinue | ForEach-Object { ($_.Name -split '\\')[-1] }) } catch {}; Get-LocalUser | ForEach-Object { [pscustomobject]@{Name=$_.Name;FullName=$_.FullName;SID=$_.SID.Value;Enabled=$_.Enabled;PasswordExpires=($null -ne $_.PasswordExpires);LastLogon=$(if($_.LastLogon){$_.LastLogon.ToUniversalTime().ToString('o')}else{''});IsAdmin=($admins -contains $_.Name)} }`, &rows)
	var out []protocol.LocalUser
	for _, r := range rows {
		out = append(out, protocol.LocalUser{Username: r.Name, FullName: r.FullName, IsAdmin: r.IsAdmin, Enabled: r.Enabled, LastLogonAt: r.LastLogon, UID: r.SID, PasswordExpires: r.PasswordExpires})
	}
	return out
}

// Security collects Defender/AV, firewall, BitLocker, UAC, RDP, SMBv1, guest account, screen lock, Windows Update posture.
func Security() map[string]interface{} {
	sec := map[string]interface{}{}
	var av []struct {
		DisplayName  string
		ProductState int
	}
	_ = psJSON(`Get-CimInstance -Namespace root/SecurityCenter2 -ClassName AntiVirusProduct -ErrorAction SilentlyContinue | Select-Object displayName,productState`, &av)
	var avs []map[string]interface{}
	for _, a := range av {
		enabled := (a.ProductState>>12)&0xF == 1
		upToDate := (a.ProductState & 0xF0) == 0
		avs = append(avs, map[string]interface{}{"name": a.DisplayName, "enabled": enabled, "upToDate": upToDate, "realtime": enabled})
	}
	var def []struct {
		AntivirusEnabled, RealTimeProtectionEnabled bool
		AntivirusSignatureLastUpdated              string
		QuickScanEndTime                           string
	}
	_ = psJSON(`try { Get-MpComputerStatus | Select-Object AntivirusEnabled,RealTimeProtectionEnabled,@{n='AntivirusSignatureLastUpdated';e={$_.AntivirusSignatureLastUpdated.ToString('o')}},@{n='QuickScanEndTime';e={if($_.QuickScanEndTime){$_.QuickScanEndTime.ToString('o')}else{''}}} } catch { }`, &def)
	if len(def) > 0 && len(avs) == 0 {
		avs = append(avs, map[string]interface{}{"name": "Microsoft Defender", "enabled": def[0].AntivirusEnabled, "realtime": def[0].RealTimeProtectionEnabled, "upToDate": true, "lastScanAt": def[0].QuickScanEndTime})
	}
	sec["antivirus"] = avs
	var fw []struct {
		Name    string
		Enabled bool
	}
	_ = psJSON(`Get-NetFirewallProfile | Select-Object Name,Enabled`, &fw)
	profiles := map[string]bool{}
	anyOn := false
	for _, p := range fw {
		profiles[strings.ToLower(p.Name)] = p.Enabled
		if p.Enabled {
			anyOn = true
		}
	}
	sec["firewall"] = map[string]interface{}{"enabled": anyOn, "profiles": profiles}
	var bl []struct {
		MountPoint, ProtectionStatus, EncryptionMethod string
		EncryptionPercentage                           float64
	}
	_ = psJSON(`try { Get-BitLockerVolume | Select-Object MountPoint,@{n='ProtectionStatus';e={$_.ProtectionStatus.ToString()}},@{n='EncryptionMethod';e={$_.EncryptionMethod.ToString()}},EncryptionPercentage } catch { }`, &bl)
	var enc []map[string]interface{}
	for _, v := range bl {
		enc = append(enc, map[string]interface{}{"volume": v.MountPoint, "encrypted": v.ProtectionStatus == "On", "method": "BitLocker " + v.EncryptionMethod, "percent": v.EncryptionPercentage})
	}
	sec["diskEncryption"] = enc
	if k, err := registry.OpenKey(registry.LOCAL_MACHINE, `SOFTWARE\Microsoft\Windows\CurrentVersion\Policies\System`, registry.QUERY_VALUE); err == nil {
		v, _, _ := k.GetIntegerValue("EnableLUA")
		sec["uacEnabled"] = v == 1
		k.Close()
	}
	if k, err := registry.OpenKey(registry.LOCAL_MACHINE, `SYSTEM\CurrentControlSet\Control\Terminal Server`, registry.QUERY_VALUE); err == nil {
		v, _, _ := k.GetIntegerValue("fDenyTSConnections")
		sec["remoteDesktopEnabled"] = v == 0
		k.Close()
	}
	if out, err := ps(`(Get-WindowsOptionalFeature -Online -FeatureName SMB1Protocol -ErrorAction SilentlyContinue).State`); err == nil {
		sec["smbV1Enabled"] = strings.Contains(string(out), "Enabled")
	}
	if out, err := ps(`(Get-LocalUser -Name Guest -ErrorAction SilentlyContinue).Enabled`); err == nil {
		sec["guestAccountEnabled"] = strings.Contains(string(out), "True")
	}
	if out, err := ps(`(Get-ItemProperty 'HKCU:\Control Panel\Desktop' -ErrorAction SilentlyContinue).ScreenSaveTimeOut`); err == nil {
		if s := strings.TrimSpace(string(out)); s != "" {
			sec["screenLockSeconds"] = s
		}
	}
	if out, err := ps(`try { Confirm-SecureBootUEFI } catch { 'False' }`); err == nil {
		sec["secureBoot"] = strings.Contains(string(out), "True")
	}
	if out, err := ps(`try { (Get-Tpm).TpmEnabled } catch { 'False' }`); err == nil {
		sec["tpmEnabled"] = strings.Contains(string(out), "True")
	}
	if out, err := ps(`(Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\WindowsUpdate\Auto Update' -ErrorAction SilentlyContinue).AUOptions`); err == nil {
		sec["autoUpdateEnabled"] = strings.TrimSpace(string(out)) != "1"
	}
	var admins []string
	for _, u := range LocalUsers() {
		if u.IsAdmin && u.Enabled {
			admins = append(admins, u.Username)
		}
	}
	sec["localAdmins"] = admins
	sec["collectedAt"] = time.Now().UTC().Format(time.RFC3339)
	return sec
}
