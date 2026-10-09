// Package collectors gathers telemetry and inventory using gopsutil plus OS-specific helpers.
package collectors

import (
	"runtime"
	"sort"
	"sync"
	"time"

	"github.com/shirou/gopsutil/v4/cpu"
	"github.com/shirou/gopsutil/v4/disk"
	"github.com/shirou/gopsutil/v4/host"
	"github.com/shirou/gopsutil/v4/load"
	"github.com/shirou/gopsutil/v4/mem"
	gnet "github.com/shirou/gopsutil/v4/net"
	"github.com/shirou/gopsutil/v4/process"
	"github.com/shirou/gopsutil/v4/sensors"

	"github.com/cyberwizard2k26/nextjs-magicwand/agent/internal/protocol"
)

type netSnapshot struct {
	rx, tx uint64
	at     time.Time
}

var (
	netMu   sync.Mutex
	lastNet *netSnapshot
)

func f64(v float64) *float64 { return &v }
func u64(v uint64) *uint64   { return &v }
func i(v int) *int           { return &v }

// Telemetry samples CPU, memory, disks, network throughput, uptime, load and top processes.
func Telemetry() *protocol.Telemetry {
	t := &protocol.Telemetry{T: "telemetry", TS: time.Now().UTC().Format(time.RFC3339)}
	if pct, err := cpu.Percent(500*time.Millisecond, false); err == nil && len(pct) > 0 {
		t.CPUPercent = f64(round(pct[0]))
	}
	if vm, err := mem.VirtualMemory(); err == nil {
		t.MemUsedBytes = u64(vm.Used)
		t.MemTotalBytes = u64(vm.Total)
	}
	if sw, err := mem.SwapMemory(); err == nil {
		t.SwapUsedBytes = u64(sw.Used)
	}
	if parts, err := disk.Partitions(false); err == nil {
		for _, p := range parts {
			if skipMount(p.Mountpoint, p.Fstype) {
				continue
			}
			if u, err := disk.Usage(p.Mountpoint); err == nil && u.Total > 0 {
				t.Disks = append(t.Disks, protocol.DiskSample{Mount: p.Mountpoint, UsedBytes: u.Used, TotalBytes: u.Total})
			}
		}
	}
	if io, err := gnet.IOCounters(false); err == nil && len(io) > 0 {
		netMu.Lock()
		now := time.Now()
		if lastNet != nil {
			secs := now.Sub(lastNet.at).Seconds()
			if secs > 0 {
				t.NetRxBps = f64(round(float64(io[0].BytesRecv-lastNet.rx) / secs))
				t.NetTxBps = f64(round(float64(io[0].BytesSent-lastNet.tx) / secs))
			}
		}
		lastNet = &netSnapshot{rx: io[0].BytesRecv, tx: io[0].BytesSent, at: now}
		netMu.Unlock()
	}
	if up, err := host.Uptime(); err == nil {
		t.UptimeSeconds = u64(up)
	}
	if runtime.GOOS != "windows" {
		if l, err := load.Avg(); err == nil {
			t.LoadAvg = &[3]float64{round(l.Load1), round(l.Load5), round(l.Load15)}
		}
	}
	if temps, err := sensors.SensorsTemperatures(); err == nil {
		for _, s := range temps {
			if s.Temperature > 0 && len(t.Temperatures) < 12 {
				t.Temperatures = append(t.Temperatures, protocol.Temperature{Sensor: s.SensorKey, Celsius: round(s.Temperature)})
			}
		}
	}
	if pct, ok := batteryPercent(); ok {
		t.BatteryPercent = f64(pct)
	}
	t.ProcessCount, t.TopProcesses = topProcesses(5)
	return t
}

func round(v float64) float64 { return float64(int(v*10+0.5)) / 10 }

func skipMount(mount, fs string) bool {
	switch fs {
	case "squashfs", "tmpfs", "devtmpfs", "overlay", "proc", "sysfs", "cgroup", "cgroup2", "devfs", "autofs", "efivarfs", "fusectl", "debugfs", "tracefs", "securityfs", "pstore", "bpf", "hugetlbfs", "mqueue", "configfs", "binfmt_misc", "nsfs", "rpc_pipefs", "ramfs":
		return true
	}
	for _, p := range []string{"/snap/", "/proc", "/sys", "/dev", "/run/", "/boot/efi", "/System/Volumes/"} {
		if len(mount) >= len(p) && mount[:len(p)] == p {
			return true
		}
	}
	return false
}

func topProcesses(n int) (*int, []protocol.TopProcess) {
	procs, err := process.Processes()
	if err != nil {
		return nil, nil
	}
	count := len(procs)
	var top []protocol.TopProcess
	for _, p := range procs {
		name, err := p.Name()
		if err != nil || name == "" {
			continue
		}
		c, _ := p.CPUPercent()
		var rss uint64
		if mi, err := p.MemoryInfo(); err == nil && mi != nil {
			rss = mi.RSS
		}
		top = append(top, protocol.TopProcess{Name: name, PID: p.Pid, CPU: round(c), MemBytes: rss})
	}
	sort.Slice(top, func(a, b int) bool {
		if top[a].CPU != top[b].CPU {
			return top[a].CPU > top[b].CPU
		}
		return top[a].MemBytes > top[b].MemBytes
	})
	if len(top) > n {
		top = top[:n]
	}
	return i(count), top
}
