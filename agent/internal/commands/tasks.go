package commands

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"

	"github.com/cyberwizard2k26/nextjs-magicwand/agent/internal/platform"
)

type scheduledTask struct {
	Name       string `json:"name"`
	Path       string `json:"path,omitempty"`
	Source     string `json:"source"` // task_scheduler | systemd_timer | cron | launchd
	State      string `json:"state"`  // ready | running | disabled | unknown
	Schedule   string `json:"schedule,omitempty"`
	Command    string `json:"command,omitempty"`
	User       string `json:"user,omitempty"`
	LastRun    string `json:"lastRun,omitempty"`
	NextRun    string `json:"nextRun,omitempty"`
	LastResult string `json:"lastResult,omitempty"`
	Author     string `json:"author,omitempty"`
	CanControl bool   `json:"canControl"`
}

// TaskSchedulerList enumerates scheduled work: Task Scheduler, systemd timers + cron, launchd.
func TaskSchedulerList(ctx context.Context, c *Command) (interface{}, error) {
	var tasks []scheduledTask
	var err error
	switch runtime.GOOS {
	case "windows":
		tasks, err = windowsTasks(ctx)
	case "darwin":
		tasks, err = macTasks(ctx)
	default:
		tasks, err = linuxTasks(ctx)
	}
	if err != nil {
		return nil, err
	}
	if tasks == nil {
		tasks = []scheduledTask{}
	}
	return map[string]interface{}{"tasks": tasks, "count": len(tasks)}, nil
}

// TaskSchedulerAction: { name, path?, source?, action: run|enable|disable }
func TaskSchedulerAction(ctx context.Context, c *Command) (interface{}, error) {
	var a struct {
		Name   string `json:"name"`
		Path   string `json:"path"`
		Source string `json:"source"`
		Action string `json:"action"`
	}
	if err := c.Arg(&a); err != nil {
		return nil, err
	}
	if a.Name == "" || strings.ContainsAny(a.Name, "\n\r") {
		return nil, errors.New("task name is required")
	}
	switch runtime.GOOS {
	case "windows":
		verb := map[string]string{"run": "Start-ScheduledTask", "enable": "Enable-ScheduledTask", "disable": "Disable-ScheduledTask"}[a.Action]
		if verb == "" {
			return nil, fmt.Errorf("unknown action %q", a.Action)
		}
		p := a.Path
		if p == "" {
			p = `\`
		}
		out, err := ps(ctx, verb+" -TaskName "+psq(a.Name)+" -TaskPath "+psq(p)+" | Out-Null; 'ok'", "")
		if err != nil {
			return nil, err
		}
		return map[string]interface{}{"ok": true, "output": out}, nil
	case "darwin":
		target := "system/" + a.Name
		var err error
		switch a.Action {
		case "run":
			_, err = runOut(ctx, "launchctl", "kickstart", target)
		case "enable":
			_, err = runOut(ctx, "launchctl", "enable", target)
		case "disable":
			_, err = runOut(ctx, "launchctl", "disable", target)
		default:
			return nil, fmt.Errorf("unknown action %q", a.Action)
		}
		if err != nil {
			return nil, err
		}
		return map[string]interface{}{"ok": true}, nil
	default:
		if a.Source == "cron" {
			return nil, errors.New("cron entries are edited in the crontab file; only systemd timers can be controlled here")
		}
		unit := a.Name
		if !strings.Contains(unit, ".") {
			unit += ".timer"
		}
		var err error
		switch a.Action {
		case "run":
			// Trigger the service the timer activates.
			svc := strings.TrimSuffix(unit, ".timer") + ".service"
			_, err = runOut(ctx, "systemctl", "start", svc)
		case "enable":
			_, err = runOut(ctx, "systemctl", "enable", "--now", unit)
		case "disable":
			_, err = runOut(ctx, "systemctl", "disable", "--now", unit)
		default:
			return nil, fmt.Errorf("unknown action %q", a.Action)
		}
		if err != nil {
			return nil, err
		}
		return map[string]interface{}{"ok": true}, nil
	}
}

func windowsTasks(ctx context.Context) ([]scheduledTask, error) {
	script := `Get-ScheduledTask | Where-Object { $_.TaskPath -notlike '\Microsoft\Windows\*' -or $_.State -eq 'Running' } | ForEach-Object {
  $i = $_ | Get-ScheduledTaskInfo -ErrorAction SilentlyContinue
  [pscustomobject]@{
    name=$_.TaskName; path=$_.TaskPath; state=[string]$_.State; author=[string]$_.Author; user=[string]$_.Principal.UserId
    lastRun= if($i -and $i.LastRunTime -and $i.LastRunTime.Year -gt 1999){$i.LastRunTime.ToUniversalTime().ToString('o')} else {''}
    nextRun= if($i -and $i.NextRunTime -and $i.NextRunTime.Year -gt 1999){$i.NextRunTime.ToUniversalTime().ToString('o')} else {''}
    lastResult= if($i){[string]$i.LastTaskResult} else {''}
    command=(($_.Actions | ForEach-Object { ("$($_.Execute) $($_.Arguments)").Trim() }) -join '; ')
    schedule=(($_.Triggers | ForEach-Object { $_.CimClass.CimClassName -replace '^MSFT_Task','' -replace 'Trigger$','' }) -join ', ')
  }
} | ConvertTo-Json -Compress -Depth 3`
	rows, err := psJSON(ctx, script, "")
	if err != nil {
		return nil, err
	}
	out := make([]scheduledTask, 0, len(rows))
	for _, r := range rows {
		state := strings.ToLower(str(r, "state"))
		if state == "" {
			state = "unknown"
		}
		out = append(out, scheduledTask{Name: str(r, "name"), Path: str(r, "path"), Source: "task_scheduler", State: state, Schedule: str(r, "schedule"), Command: str(r, "command"), User: str(r, "user"), LastRun: str(r, "lastRun"), NextRun: str(r, "nextRun"), LastResult: str(r, "lastResult"), Author: str(r, "author"), CanControl: true})
	}
	return out, nil
}

func linuxTasks(ctx context.Context) ([]scheduledTask, error) {
	var out []scheduledTask
	if has("systemctl") {
		cmd := exec.CommandContext(ctx, "systemctl", "list-timers", "--all", "--no-pager", "--output=json")
		platform.PrepareCommand(cmd, "")
		if raw, err := cmd.Output(); err == nil {
			var rows []map[string]interface{}
			if json.Unmarshal(raw, &rows) == nil {
				for _, r := range rows {
					unit := str(r, "unit")
					state := "ready"
					if str(r, "next") == "" && str(r, "left") == "" {
						state = "disabled"
					}
					out = append(out, scheduledTask{Name: unit, Source: "systemd_timer", State: state, Command: str(r, "activates"), LastRun: str(r, "last"), NextRun: str(r, "next"), CanControl: true})
				}
			}
		} else {
			// Older systemd: parse the table.
			if txt, err := runOut(ctx, "systemctl", "list-timers", "--all", "--no-pager", "--no-legend"); err == nil {
				for _, line := range strings.Split(txt, "\n") {
					f := strings.Fields(line)
					if len(f) < 2 {
						continue
					}
					unit := ""
					for _, x := range f {
						if strings.HasSuffix(x, ".timer") {
							unit = x
						}
					}
					if unit == "" {
						continue
					}
					out = append(out, scheduledTask{Name: unit, Source: "systemd_timer", State: "ready", Command: f[len(f)-1], CanControl: true})
				}
			}
		}
	}
	// cron: system crontab, cron.d and per-user spools.
	addCron := func(path string, hasUser bool, user string) {
		b, err := os.ReadFile(path)
		if err != nil {
			return
		}
		for _, line := range strings.Split(string(b), "\n") {
			l := strings.TrimSpace(line)
			if l == "" || strings.HasPrefix(l, "#") || strings.Contains(l, "=") && !strings.HasPrefix(l, "*") && !strings.HasPrefix(l, "@") && !strings.ContainsAny(l[:1], "0123456789") {
				continue
			}
			f := strings.Fields(l)
			n := 5
			if strings.HasPrefix(l, "@") {
				n = 1
			}
			if len(f) <= n {
				continue
			}
			sched := strings.Join(f[:n], " ")
			rest := f[n:]
			u := user
			if hasUser && len(rest) > 1 {
				u, rest = rest[0], rest[1:]
			}
			cmd := strings.Join(rest, " ")
			out = append(out, scheduledTask{Name: filepath.Base(path) + ": " + truncateStr(cmd, 60), Path: path, Source: "cron", State: "ready", Schedule: sched, Command: cmd, User: u})
		}
	}
	addCron("/etc/crontab", true, "root")
	if entries, err := os.ReadDir("/etc/cron.d"); err == nil {
		for _, e := range entries {
			if !e.IsDir() && !strings.HasPrefix(e.Name(), ".") {
				addCron(filepath.Join("/etc/cron.d", e.Name()), true, "root")
			}
		}
	}
	for _, spool := range []string{"/var/spool/cron/crontabs", "/var/spool/cron"} {
		if entries, err := os.ReadDir(spool); err == nil {
			for _, e := range entries {
				if !e.IsDir() {
					addCron(filepath.Join(spool, e.Name()), false, e.Name())
				}
			}
		}
	}
	for _, period := range []string{"hourly", "daily", "weekly", "monthly"} {
		if entries, err := os.ReadDir("/etc/cron." + period); err == nil {
			for _, e := range entries {
				if !e.IsDir() {
					out = append(out, scheduledTask{Name: e.Name(), Path: "/etc/cron." + period + "/" + e.Name(), Source: "cron", State: "ready", Schedule: "@" + period, Command: "/etc/cron." + period + "/" + e.Name(), User: "root"})
				}
			}
		}
	}
	return out, nil
}

func macTasks(ctx context.Context) ([]scheduledTask, error) {
	loaded := map[string]string{}
	if txt, err := runOut(ctx, "launchctl", "list"); err == nil {
		for _, line := range strings.Split(txt, "\n")[1:] {
			f := strings.Fields(line)
			if len(f) >= 3 {
				loaded[f[2]] = f[0]
			}
		}
	}
	var out []scheduledTask
	for _, dir := range []string{"/Library/LaunchDaemons", "/Library/LaunchAgents"} {
		entries, err := os.ReadDir(dir)
		if err != nil {
			continue
		}
		for _, e := range entries {
			if e.IsDir() || !strings.HasSuffix(e.Name(), ".plist") {
				continue
			}
			path := filepath.Join(dir, e.Name())
			cmd := exec.CommandContext(ctx, "plutil", "-convert", "json", "-o", "-", path)
			raw, err := cmd.Output()
			if err != nil {
				continue
			}
			var m map[string]interface{}
			if json.Unmarshal(raw, &m) != nil {
				continue
			}
			label := str(m, "Label")
			if label == "" {
				label = strings.TrimSuffix(e.Name(), ".plist")
			}
			command := str(m, "Program")
			if args, ok := m["ProgramArguments"].([]interface{}); ok && len(args) > 0 {
				parts := make([]string, 0, len(args))
				for _, x := range args {
					parts = append(parts, fmt.Sprint(x))
				}
				command = strings.Join(parts, " ")
			}
			sched := ""
			if v, ok := m["StartInterval"]; ok {
				sched = "every " + fmt.Sprint(v) + "s"
			} else if _, ok := m["StartCalendarInterval"]; ok {
				sched = "calendar"
			} else if boolean(m, "RunAtLoad") {
				sched = "at load"
			} else if boolean(m, "KeepAlive") {
				sched = "keep alive"
			}
			state := "ready"
			if boolean(m, "Disabled") {
				state = "disabled"
			} else if pid, ok := loaded[label]; ok && pid != "-" && pid != "0" {
				state = "running"
			} else if _, ok := loaded[label]; !ok {
				state = "unknown"
			}
			out = append(out, scheduledTask{Name: label, Path: path, Source: "launchd", State: state, Schedule: sched, Command: command, User: str(m, "UserName"), CanControl: true})
		}
	}
	return out, nil
}

func truncateStr(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n-1] + "…"
}
