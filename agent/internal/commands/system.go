package commands

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"net"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"sort"
	"strings"
	"time"

	"github.com/shirou/gopsutil/v4/process"
)

// ProcessList returns running processes with cpu/mem/user/command line.
func ProcessList(ctx context.Context, c *Command) (interface{}, error) {
	procs, err := process.ProcessesWithContext(ctx)
	if err != nil {
		return nil, err
	}
	type row struct {
		PID      int32   `json:"pid"`
		PPID     int32   `json:"ppid"`
		Name     string  `json:"name"`
		User     string  `json:"user,omitempty"`
		CPU      float64 `json:"cpu"`
		MemBytes uint64  `json:"memBytes"`
		Cmdline  string  `json:"cmdline,omitempty"`
		Exe      string  `json:"exe,omitempty"`
		Started  string  `json:"started,omitempty"`
		Status   string  `json:"status,omitempty"`
	}
	var rows []row
	for _, p := range procs {
		name, err := p.NameWithContext(ctx)
		if err != nil {
			continue
		}
		r := row{PID: p.Pid, Name: name}
		r.PPID, _ = p.PpidWithContext(ctx)
		r.User, _ = p.UsernameWithContext(ctx)
		r.CPU, _ = p.CPUPercentWithContext(ctx)
		if mi, err := p.MemoryInfoWithContext(ctx); err == nil && mi != nil {
			r.MemBytes = mi.RSS
		}
		r.Cmdline, _ = p.CmdlineWithContext(ctx)
		if len(r.Cmdline) > 512 {
			r.Cmdline = r.Cmdline[:512]
		}
		r.Exe, _ = p.ExeWithContext(ctx)
		if ct, err := p.CreateTimeWithContext(ctx); err == nil && ct > 0 {
			r.Started = time.UnixMilli(ct).UTC().Format(time.RFC3339)
		}
		if st, err := p.StatusWithContext(ctx); err == nil && len(st) > 0 {
			r.Status = st[0]
		}
		rows = append(rows, r)
	}
	sort.Slice(rows, func(i, j int) bool { return rows[i].CPU > rows[j].CPU })
	return map[string]interface{}{"processes": rows, "count": len(rows)}, nil
}

// ProcessKill: { pid?, name?, force? }
func ProcessKill(ctx context.Context, c *Command) (interface{}, error) {
	var a struct {
		PID   int32  `json:"pid"`
		Name  string `json:"name"`
		Force bool   `json:"force"`
	}
	if err := c.Arg(&a); err != nil {
		return nil, err
	}
	var killed []int32
	procs, err := process.ProcessesWithContext(ctx)
	if err != nil {
		return nil, err
	}
	for _, p := range procs {
		if a.PID != 0 && p.Pid != a.PID {
			continue
		}
		if a.PID == 0 {
			n, _ := p.Name()
			if a.Name == "" || !strings.EqualFold(n, a.Name) {
				continue
			}
		}
		if p.Pid == int32(os.Getpid()) {
			continue
		}
		var err error
		if a.Force {
			err = p.KillWithContext(ctx)
		} else {
			err = p.TerminateWithContext(ctx)
		}
		if err == nil {
			killed = append(killed, p.Pid)
		}
	}
	if len(killed) == 0 {
		return nil, errors.New("no matching process")
	}
	return map[string]interface{}{"killed": killed}, nil
}

// ProcessStart: { command, args?, cwd? } - starts a detached process.
func ProcessStart(ctx context.Context, c *Command) (interface{}, error) {
	var a struct {
		Command string   `json:"command"`
		Args    []string `json:"args"`
		Cwd     string   `json:"cwd"`
	}
	if err := c.Arg(&a); err != nil {
		return nil, err
	}
	cmd := exec.Command(a.Command, a.Args...)
	cmd.Dir = a.Cwd
	if err := cmd.Start(); err != nil {
		return nil, err
	}
	pid := cmd.Process.Pid
	go func() { _ = cmd.Wait() }()
	return map[string]interface{}{"pid": pid}, nil
}

type fileEntry struct {
	Name     string `json:"name"`
	Path     string `json:"path"`
	IsDir    bool   `json:"isDir"`
	Size     int64  `json:"size"`
	Mode     string `json:"mode"`
	Modified string `json:"modified"`
	Symlink  bool   `json:"symlink,omitempty"`
	Hidden   bool   `json:"hidden,omitempty"`
}

// FileList: { path } - lists a directory (drives/roots when path is empty).
func FileList(ctx context.Context, c *Command) (interface{}, error) {
	var a struct {
		Path string `json:"path"`
	}
	if err := c.Arg(&a); err != nil {
		return nil, err
	}
	if a.Path == "" {
		if runtime.GOOS == "windows" {
			var roots []fileEntry
			for _, d := range "ABCDEFGHIJKLMNOPQRSTUVWXYZ" {
				p := string(d) + ":\\"
				if st, err := os.Stat(p); err == nil && st.IsDir() {
					roots = append(roots, fileEntry{Name: p, Path: p, IsDir: true})
				}
			}
			return map[string]interface{}{"path": "", "entries": roots}, nil
		}
		a.Path = "/"
	}
	entries, err := os.ReadDir(a.Path)
	if err != nil {
		return nil, err
	}
	var out []fileEntry
	for _, e := range entries {
		full := filepath.Join(a.Path, e.Name())
		info, err := e.Info()
		fe := fileEntry{Name: e.Name(), Path: full, IsDir: e.IsDir(), Hidden: strings.HasPrefix(e.Name(), ".")}
		if err == nil {
			fe.Size = info.Size()
			fe.Mode = info.Mode().String()
			fe.Modified = info.ModTime().UTC().Format(time.RFC3339)
			fe.Symlink = info.Mode()&os.ModeSymlink != 0
		}
		out = append(out, fe)
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].IsDir != out[j].IsDir {
			return out[i].IsDir
		}
		return strings.ToLower(out[i].Name) < strings.ToLower(out[j].Name)
	})
	return map[string]interface{}{"path": a.Path, "entries": out}, nil
}

// FileRead: { path, maxBytes? } - returns base64 content (small files / previews).
func FileRead(ctx context.Context, c *Command) (interface{}, error) {
	var a struct {
		Path     string `json:"path"`
		MaxBytes int64  `json:"maxBytes"`
		Offset   int64  `json:"offset"`
	}
	if err := c.Arg(&a); err != nil {
		return nil, err
	}
	if a.MaxBytes <= 0 || a.MaxBytes > 8<<20 {
		a.MaxBytes = 8 << 20
	}
	f, err := os.Open(a.Path)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	st, _ := f.Stat()
	if a.Offset > 0 {
		if _, err := f.Seek(a.Offset, io.SeekStart); err != nil {
			return nil, err
		}
	}
	buf, err := io.ReadAll(io.LimitReader(f, a.MaxBytes))
	if err != nil {
		return nil, err
	}
	return map[string]interface{}{"path": a.Path, "size": st.Size(), "truncated": st.Size() > a.Offset+int64(len(buf)), "contentBase64": base64.StdEncoding.EncodeToString(buf)}, nil
}

// FileWrite: { path, contentBase64, mode?, append? }
func FileWrite(ctx context.Context, c *Command) (interface{}, error) {
	var a struct {
		Path          string `json:"path"`
		ContentBase64 string `json:"contentBase64"`
		Append        bool   `json:"append"`
	}
	if err := c.Arg(&a); err != nil {
		return nil, err
	}
	data, err := base64.StdEncoding.DecodeString(a.ContentBase64)
	if err != nil {
		return nil, err
	}
	if err := os.MkdirAll(filepath.Dir(a.Path), 0o755); err != nil {
		return nil, err
	}
	flags := os.O_CREATE | os.O_WRONLY | os.O_TRUNC
	if a.Append {
		flags = os.O_CREATE | os.O_WRONLY | os.O_APPEND
	}
	f, err := os.OpenFile(a.Path, flags, 0o644)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	n, err := f.Write(data)
	return map[string]interface{}{"written": n}, err
}

// FileDelete: { path, recursive? }
func FileDelete(ctx context.Context, c *Command) (interface{}, error) {
	var a struct {
		Path      string `json:"path"`
		Recursive bool   `json:"recursive"`
	}
	if err := c.Arg(&a); err != nil {
		return nil, err
	}
	if a.Path == "" || a.Path == "/" || a.Path == `C:\` {
		return nil, errors.New("refusing to delete root")
	}
	if a.Recursive {
		return nil, os.RemoveAll(a.Path)
	}
	return nil, os.Remove(a.Path)
}

// FileMkdir: { path }
func FileMkdir(ctx context.Context, c *Command) (interface{}, error) {
	var a struct {
		Path string `json:"path"`
	}
	if err := c.Arg(&a); err != nil {
		return nil, err
	}
	return nil, os.MkdirAll(a.Path, 0o755)
}

// FileRename: { from, to }
func FileRename(ctx context.Context, c *Command) (interface{}, error) {
	var a struct {
		From string `json:"from"`
		To   string `json:"to"`
	}
	if err := c.Arg(&a); err != nil {
		return nil, err
	}
	return nil, os.Rename(a.From, a.To)
}

// FileHash: { path }
func FileHash(ctx context.Context, c *Command) (interface{}, error) {
	var a struct {
		Path string `json:"path"`
	}
	if err := c.Arg(&a); err != nil {
		return nil, err
	}
	f, err := os.Open(a.Path)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	h := sha256.New()
	n, err := io.Copy(h, f)
	if err != nil {
		return nil, err
	}
	return map[string]interface{}{"sha256": hex.EncodeToString(h.Sum(nil)), "size": n}, nil
}

// FileSearch: { root, pattern, maxResults? } - case-insensitive substring/glob search of file names.
func FileSearch(ctx context.Context, c *Command) (interface{}, error) {
	var a struct {
		Root       string `json:"root"`
		Pattern    string `json:"pattern"`
		MaxResults int    `json:"maxResults"`
	}
	if err := c.Arg(&a); err != nil {
		return nil, err
	}
	if a.MaxResults <= 0 {
		a.MaxResults = 500
	}
	pat := strings.ToLower(a.Pattern)
	var out []fileEntry
	err := filepath.WalkDir(a.Root, func(path string, d os.DirEntry, err error) error {
		if ctx.Err() != nil {
			return ctx.Err()
		}
		if err != nil {
			return nil
		}
		name := strings.ToLower(d.Name())
		match := strings.Contains(name, pat)
		if !match {
			if ok, _ := filepath.Match(pat, name); ok {
				match = true
			}
		}
		if match {
			info, _ := d.Info()
			fe := fileEntry{Name: d.Name(), Path: path, IsDir: d.IsDir()}
			if info != nil {
				fe.Size = info.Size()
				fe.Modified = info.ModTime().UTC().Format(time.RFC3339)
			}
			out = append(out, fe)
			if len(out) >= a.MaxResults {
				return io.EOF
			}
		}
		return nil
	})
	if err != nil && err != io.EOF && err != context.Canceled && err != context.DeadlineExceeded {
		return nil, err
	}
	return map[string]interface{}{"entries": out, "truncated": len(out) >= a.MaxResults}, nil
}

// WakeOnLAN: { mac, broadcast? }
func WakeOnLAN(ctx context.Context, c *Command) (interface{}, error) {
	var a struct {
		MAC       string `json:"mac"`
		Broadcast string `json:"broadcast"`
	}
	if err := c.Arg(&a); err != nil {
		return nil, err
	}
	hw, err := net.ParseMAC(a.MAC)
	if err != nil {
		return nil, err
	}
	if a.Broadcast == "" {
		a.Broadcast = "255.255.255.255"
	}
	pkt := make([]byte, 6, 102)
	for i := range pkt {
		pkt[i] = 0xFF
	}
	for i := 0; i < 16; i++ {
		pkt = append(pkt, hw...)
	}
	for _, port := range []string{"9", "7"} {
		conn, err := net.Dial("udp", net.JoinHostPort(a.Broadcast, port))
		if err != nil {
			continue
		}
		_, _ = conn.Write(pkt)
		conn.Close()
	}
	return map[string]interface{}{"sent": true, "mac": hw.String()}, nil
}

// Ping: { host, count? }
func Ping(ctx context.Context, c *Command) (interface{}, error) {
	var a struct {
		Host  string `json:"host"`
		Count int    `json:"count"`
	}
	if err := c.Arg(&a); err != nil {
		return nil, err
	}
	if a.Count <= 0 {
		a.Count = 4
	}
	var cmd *exec.Cmd
	if runtime.GOOS == "windows" {
		cmd = exec.CommandContext(ctx, "ping", "-n", fmt.Sprint(a.Count), a.Host)
	} else {
		cmd = exec.CommandContext(ctx, "ping", "-c", fmt.Sprint(a.Count), "-W", "2", a.Host)
	}
	out, err := cmd.CombinedOutput()
	c.Emit("stdout", out)
	if cmd.ProcessState != nil {
		c.SetExitCode(cmd.ProcessState.ExitCode())
	}
	if err != nil && ctx.Err() != nil {
		return nil, ctx.Err()
	}
	return map[string]interface{}{"reachable": err == nil}, nil
}

// PortCheck: { host, port, timeoutMs? }
func PortCheck(ctx context.Context, c *Command) (interface{}, error) {
	var a struct {
		Host      string `json:"host"`
		Port      int    `json:"port"`
		TimeoutMs int    `json:"timeoutMs"`
	}
	if err := c.Arg(&a); err != nil {
		return nil, err
	}
	if a.TimeoutMs <= 0 {
		a.TimeoutMs = 3000
	}
	start := time.Now()
	d := net.Dialer{Timeout: time.Duration(a.TimeoutMs) * time.Millisecond}
	conn, err := d.DialContext(ctx, "tcp", net.JoinHostPort(a.Host, fmt.Sprint(a.Port)))
	if err != nil {
		return map[string]interface{}{"open": false, "error": err.Error()}, nil
	}
	conn.Close()
	return map[string]interface{}{"open": true, "latencyMs": time.Since(start).Milliseconds()}, nil
}

// DNSLookup: { name }
func DNSLookup(ctx context.Context, c *Command) (interface{}, error) {
	var a struct {
		Name string `json:"name"`
	}
	if err := c.Arg(&a); err != nil {
		return nil, err
	}
	start := time.Now()
	ips, err := net.DefaultResolver.LookupHost(ctx, a.Name)
	if err != nil {
		return nil, err
	}
	return map[string]interface{}{"addresses": ips, "latencyMs": time.Since(start).Milliseconds()}, nil
}

// Traceroute: { host }
func Traceroute(ctx context.Context, c *Command) (interface{}, error) {
	var a struct {
		Host string `json:"host"`
	}
	if err := c.Arg(&a); err != nil {
		return nil, err
	}
	var cmd *exec.Cmd
	if runtime.GOOS == "windows" {
		cmd = exec.CommandContext(ctx, "tracert", "-d", "-w", "1000", a.Host)
	} else {
		cmd = exec.CommandContext(ctx, "traceroute", "-n", "-w", "1", a.Host)
	}
	out, err := cmd.CombinedOutput()
	c.Emit("stdout", out)
	if err != nil && ctx.Err() != nil {
		return nil, ctx.Err()
	}
	return nil, nil
}
