package commands

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"strings"
)

// ServiceAction: { name, action: start|stop|restart|enable|disable|status, startType?: auto|manual|disabled|delayed }
func ServiceAction(ctx context.Context, c *Command) (interface{}, error) {
	var a struct {
		Name      string `json:"name"`
		Action    string `json:"action"`
		StartType string `json:"startType"`
	}
	if err := c.Arg(&a); err != nil {
		return nil, err
	}
	a.Name = strings.TrimSpace(a.Name)
	if a.Name == "" || strings.ContainsAny(a.Name, "\n\r") {
		return nil, errors.New("service name is required")
	}
	if a.Action == "" {
		a.Action = "status"
	}
	switch runtime.GOOS {
	case "windows":
		return windowsService(ctx, a.Name, a.Action, a.StartType)
	case "darwin":
		return macService(ctx, a.Name, a.Action)
	default:
		return linuxService(ctx, a.Name, a.Action, a.StartType)
	}
}

func windowsService(ctx context.Context, name, action, startType string) (interface{}, error) {
	n := psq(name)
	var ops []string
	switch action {
	case "start":
		ops = append(ops, "Start-Service -Name "+n)
	case "stop":
		ops = append(ops, "Stop-Service -Name "+n+" -Force")
	case "restart":
		ops = append(ops, "Restart-Service -Name "+n+" -Force")
	case "enable":
		ops = append(ops, "Set-Service -Name "+n+" -StartupType Automatic")
	case "disable":
		ops = append(ops, "Set-Service -Name "+n+" -StartupType Disabled", "Stop-Service -Name "+n+" -Force -ErrorAction SilentlyContinue")
	case "status":
	default:
		return nil, fmt.Errorf("unknown action %q", action)
	}
	if startType != "" {
		st := map[string]string{"auto": "Automatic", "manual": "Manual", "disabled": "Disabled", "delayed": "AutomaticDelayedStart"}[startType]
		if st == "" {
			return nil, fmt.Errorf("unknown start type %q", startType)
		}
		ops = append(ops, "Set-Service -Name "+n+" -StartupType "+st)
	}
	script := strings.Join(ops, "\n") + "\nGet-Service -Name " + n + " | Select-Object Name,DisplayName,@{n='status';e={[string]$_.Status}},@{n='startType';e={[string]$_.StartType}} | ConvertTo-Json -Compress"
	rows, err := psJSON(ctx, script, "")
	if err != nil {
		return nil, err
	}
	if len(rows) == 0 {
		return nil, fmt.Errorf("service %q not found", name)
	}
	r := rows[0]
	return map[string]interface{}{"name": str(r, "Name"), "displayName": str(r, "DisplayName"), "status": strings.ToLower(str(r, "status")), "startType": normalizeStartType(str(r, "startType"))}, nil
}

func normalizeStartType(s string) string {
	switch strings.ToLower(s) {
	case "automatic":
		return "auto"
	case "automaticdelayedstart":
		return "delayed"
	case "manual":
		return "manual"
	case "disabled":
		return "disabled"
	}
	return strings.ToLower(s)
}

func linuxService(ctx context.Context, name, action, startType string) (interface{}, error) {
	if !has("systemctl") {
		// SysV fallback
		switch action {
		case "start", "stop", "restart", "status":
			out, err := runOut(ctx, "service", name, action)
			if err != nil {
				return nil, err
			}
			return map[string]interface{}{"name": name, "status": "unknown", "output": out}, nil
		}
		return nil, unsupported("changing the start type without systemd")
	}
	var steps [][]string
	switch action {
	case "start", "stop", "restart":
		steps = append(steps, []string{action, name})
	case "enable":
		steps = append(steps, []string{"enable", name})
	case "disable":
		steps = append(steps, []string{"disable", "--now", name})
	case "status":
	default:
		return nil, fmt.Errorf("unknown action %q", action)
	}
	if startType != "" {
		switch startType {
		case "auto", "delayed":
			steps = append(steps, []string{"enable", name})
		case "manual", "disabled":
			steps = append(steps, []string{"disable", name})
		}
		if startType == "disabled" {
			steps = append(steps, []string{"mask", name})
		} else {
			steps = append(steps, []string{"unmask", name})
		}
	}
	for _, s := range steps {
		if _, err := runOut(ctx, "systemctl", s...); err != nil {
			return nil, err
		}
	}
	out, _ := runOut(ctx, "systemctl", "show", name, "-p", "ActiveState", "-p", "SubState", "-p", "UnitFileState", "-p", "MainPID", "-p", "Description", "-p", "LoadState")
	props := map[string]string{}
	for _, line := range strings.Split(out, "\n") {
		if k, v, ok := strings.Cut(line, "="); ok {
			props[k] = v
		}
	}
	if props["LoadState"] == "not-found" {
		return nil, fmt.Errorf("unit %q not found", name)
	}
	status := props["ActiveState"]
	if status == "active" {
		status = "running"
	} else if status == "inactive" || status == "failed" {
		status = "stopped"
	}
	st := "manual"
	switch props["UnitFileState"] {
	case "enabled", "enabled-runtime", "static", "indirect":
		st = "auto"
	case "masked", "masked-runtime":
		st = "disabled"
	}
	return map[string]interface{}{"name": name, "displayName": props["Description"], "status": status, "subState": props["SubState"], "startType": st, "pid": props["MainPID"]}, nil
}

func macService(ctx context.Context, label, action string) (interface{}, error) {
	target := "system/" + label
	plist := ""
	for _, dir := range []string{"/Library/LaunchDaemons", "/Library/LaunchAgents", "/System/Library/LaunchDaemons"} {
		if _, err := os.Stat(filepath.Join(dir, label+".plist")); err == nil {
			plist = filepath.Join(dir, label+".plist")
			break
		}
	}
	var err error
	switch action {
	case "start":
		if plist != "" {
			_, err = runOut(ctx, "launchctl", "bootstrap", "system", plist)
			if err != nil && strings.Contains(err.Error(), "already") {
				err = nil
			}
		}
		if err == nil {
			_, err = runOut(ctx, "launchctl", "kickstart", target)
		}
	case "stop":
		_, err = runOut(ctx, "launchctl", "bootout", target)
	case "restart":
		_, err = runOut(ctx, "launchctl", "kickstart", "-k", target)
	case "enable":
		_, err = runOut(ctx, "launchctl", "enable", target)
	case "disable":
		_, err = runOut(ctx, "launchctl", "disable", target)
		_, _ = runOut(ctx, "launchctl", "bootout", target)
	case "status":
	default:
		return nil, fmt.Errorf("unknown action %q", action)
	}
	if err != nil {
		return nil, err
	}
	out, perr := runOut(ctx, "launchctl", "print", target)
	status, pid := "stopped", ""
	if perr == nil {
		for _, line := range strings.Split(out, "\n") {
			line = strings.TrimSpace(line)
			if strings.HasPrefix(line, "state = ") {
				if strings.Contains(line, "running") {
					status = "running"
				}
			}
			if strings.HasPrefix(line, "pid = ") {
				pid = strings.TrimPrefix(line, "pid = ")
			}
		}
	}
	return map[string]interface{}{"name": label, "status": status, "pid": pid, "plist": plist, "startType": "auto"}, nil
}
