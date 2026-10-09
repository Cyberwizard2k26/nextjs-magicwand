package collectors

import (
	"net"
	"os"
	"runtime"
	"strings"
	"time"

	"github.com/shirou/gopsutil/v4/cpu"
	"github.com/shirou/gopsutil/v4/disk"
	"github.com/shirou/gopsutil/v4/host"
	"github.com/shirou/gopsutil/v4/mem"
	gnet "github.com/shirou/gopsutil/v4/net"

	"github.com/cyberwizard2k26/nextjs-magicwand/agent/internal/protocol"
)

// Platform returns the protocol platform string for this build.
func Platform() string {
	switch runtime.GOOS {
	case "windows":
		return "windows"
	case "darwin":
		return "macos"
	case "linux":
		return "linux"
	case "freebsd":
		return "freebsd"
	default:
		return "other"
	}
}

// System collects the identity/OS facts included in hello and inventory.
func System() *protocol.SystemInfo {
	s := &protocol.SystemInfo{Arch: runtime.GOARCH, Facts: map[string]interface{}{}}
	if hi, err := host.Info(); err == nil {
		s.Hostname = hi.Hostname
		s.OSName = prettyOS(hi)
		s.OSVersion = hi.PlatformVersion
		s.Kernel = hi.KernelVersion
		s.LastBootAt = time.Unix(int64(hi.BootTime), 0).UTC().Format(time.RFC3339)
		if hi.VirtualizationSystem != "" {
			s.Facts["virtualization"] = hi.VirtualizationSystem
			s.Facts["virtualizationRole"] = hi.VirtualizationRole
		}
		s.Facts["platformFamily"] = hi.PlatformFamily
	}
	if s.Hostname == "" {
		s.Hostname, _ = os.Hostname()
	}
	if tz, _ := time.Now().Zone(); tz != "" {
		s.Timezone = tz
	}
	if loc := time.Local.String(); loc != "" && loc != "Local" {
		s.Timezone = loc
	}
	s.LocalIPs, s.MacAddresses = addresses()
	s.LoggedInUser = ConsoleUser()
	applyPlatformSystem(s)
	if s.DeviceType == "" {
		s.DeviceType = guessDeviceType(s)
	}
	return s
}

func prettyOS(hi *host.InfoStat) string {
	switch runtime.GOOS {
	case "darwin":
		return "macOS " + hi.PlatformVersion
	case "windows":
		return hi.Platform
	default:
		if hi.Platform != "" {
			return strings.ToUpper(hi.Platform[:1]) + hi.Platform[1:] + " " + hi.PlatformVersion
		}
		return hi.OS
	}
}

func addresses() (ips []string, macs []string) {
	ifaces, err := net.Interfaces()
	if err != nil {
		return
	}
	for _, it := range ifaces {
		if it.Flags&net.FlagLoopback != 0 || it.Flags&net.FlagUp == 0 {
			continue
		}
		if it.HardwareAddr != nil && len(it.HardwareAddr.String()) > 0 {
			macs = append(macs, strings.ToUpper(it.HardwareAddr.String()))
		}
		addrs, _ := it.Addrs()
		for _, a := range addrs {
			if ipn, ok := a.(*net.IPNet); ok && ipn.IP.To4() != nil && !ipn.IP.IsLinkLocalUnicast() {
				ips = append(ips, ipn.IP.String())
			}
		}
	}
	return
}

func guessDeviceType(s *protocol.SystemInfo) string {
	if v, ok := s.Facts["virtualization"]; ok && v != "" {
		if r, ok := s.Facts["virtualizationRole"]; ok && r == "guest" {
			return "vm"
		}
	}
	if _, ok := batteryPercent(); ok {
		return "laptop"
	}
	if runtime.GOOS == "linux" {
		if _, err := os.Stat("/usr/bin/gnome-shell"); err != nil {
			if _, err := os.Stat("/usr/bin/startplasma-x11"); err != nil {
				return "server"
			}
		}
	}
	if strings.Contains(strings.ToLower(s.OSName), "server") {
		return "server"
	}
	return "workstation"
}

// Hardware collects CPU, memory, disks, NICs and platform-specific details (BIOS, GPU, monitors...).
func Hardware() map[string]interface{} {
	hw := map[string]interface{}{}
	if infos, err := cpu.Info(); err == nil && len(infos) > 0 {
		cores, _ := cpu.Counts(false)
		threads, _ := cpu.Counts(true)
		hw["cpu"] = map[string]interface{}{"model": strings.TrimSpace(infos[0].ModelName), "vendor": infos[0].VendorID, "cores": cores, "threads": threads, "mhz": infos[0].Mhz, "sockets": len(infos)}
	}
	if vm, err := mem.VirtualMemory(); err == nil {
		hw["memory"] = map[string]interface{}{"totalBytes": vm.Total}
	}
	var disks []map[string]interface{}
	if parts, err := disk.Partitions(false); err == nil {
		byDevice := map[string]map[string]interface{}{}
		for _, p := range parts {
			if skipMount(p.Mountpoint, p.Fstype) {
				continue
			}
			u, err := disk.Usage(p.Mountpoint)
			if err != nil || u.Total == 0 {
				continue
			}
			dev := p.Device
			d, ok := byDevice[dev]
			if !ok {
				d = map[string]interface{}{"name": dev, "sizeBytes": uint64(0), "partitions": []map[string]interface{}{}, "type": "unknown"}
				byDevice[dev] = d
				disks = append(disks, d)
			}
			d["sizeBytes"] = d["sizeBytes"].(uint64) + u.Total
			d["partitions"] = append(d["partitions"].([]map[string]interface{}), map[string]interface{}{"mount": p.Mountpoint, "fs": p.Fstype, "sizeBytes": u.Total, "usedBytes": u.Used})
		}
	}
	hw["disks"] = disks
	var nics []map[string]interface{}
	if ifaces, err := gnet.Interfaces(); err == nil {
		for _, it := range ifaces {
			up := false
			for _, f := range it.Flags {
				if f == "up" {
					up = true
				}
			}
			var v4, v6 []string
			for _, a := range it.Addrs {
				ip, _, err := net.ParseCIDR(a.Addr)
				if err != nil {
					continue
				}
				if ip.To4() != nil {
					v4 = append(v4, a.Addr)
				} else {
					v6 = append(v6, a.Addr)
				}
			}
			if it.HardwareAddr == "" && len(v4) == 0 {
				continue
			}
			nics = append(nics, map[string]interface{}{"name": it.Name, "mac": strings.ToUpper(it.HardwareAddr), "ipv4": v4, "ipv6": v6, "up": up, "mtu": it.MTU, "type": nicType(it.Name)})
		}
	}
	hw["nics"] = nics
	applyPlatformHardware(hw)
	return hw
}

func nicType(name string) string {
	n := strings.ToLower(name)
	switch {
	case strings.HasPrefix(n, "lo"):
		return "loopback"
	case strings.Contains(n, "wl"), strings.Contains(n, "wi-fi"), strings.Contains(n, "wifi"), strings.HasPrefix(n, "en0") && runtime.GOOS == "darwin":
		return "wifi"
	case strings.Contains(n, "docker"), strings.Contains(n, "veth"), strings.Contains(n, "virbr"), strings.Contains(n, "vmnet"), strings.Contains(n, "vethernet"), strings.Contains(n, "tun"), strings.Contains(n, "tap"), strings.Contains(n, "bridge"):
		return "virtual"
	default:
		return "ethernet"
	}
}

// Full builds a complete inventory message.
func Full() *protocol.Inventory {
	inv := &protocol.Inventory{T: "inventory", Full: true}
	inv.System = System()
	inv.Hardware = Hardware()
	inv.Software = Software()
	inv.Services = Services()
	inv.LocalUsers = LocalUsers()
	inv.Security = Security()
	return inv
}
