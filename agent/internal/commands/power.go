package commands

import (
	"context"
	"fmt"
	"os/exec"
	"runtime"
	"time"
)

func power(ctx context.Context, c *Command, action string) (interface{}, error) {
	var a struct {
		DelaySeconds int    `json:"delaySeconds"`
		Message      string `json:"message"`
		Force        bool   `json:"force"`
	}
	_ = c.Arg(&a)
	var cmd *exec.Cmd
	switch runtime.GOOS {
	case "windows":
		args := []string{"/t", fmt.Sprint(a.DelaySeconds)}
		switch action {
		case "reboot":
			args = append([]string{"/r"}, args...)
		case "shutdown":
			args = append([]string{"/s"}, args...)
		case "logoff":
			cmd = exec.Command("shutdown", "/l")
		case "lock":
			cmd = exec.Command("rundll32.exe", "user32.dll,LockWorkStation")
		case "sleep":
			cmd = exec.Command("rundll32.exe", "powrprof.dll,SetSuspendState", "0,1,0")
		}
		if cmd == nil {
			if a.Force {
				args = append(args, "/f")
			}
			if a.Message != "" {
				args = append(args, "/c", a.Message)
			}
			cmd = exec.Command("shutdown", args...)
		}
	case "darwin":
		switch action {
		case "reboot":
			cmd = exec.Command("sh", "-c", fmt.Sprintf("sleep %d; shutdown -r now", a.DelaySeconds))
		case "shutdown":
			cmd = exec.Command("sh", "-c", fmt.Sprintf("sleep %d; shutdown -h now", a.DelaySeconds))
		case "lock":
			cmd = exec.Command("sh", "-c", `osascript -e 'tell application "System Events" to keystroke "q" using {command down, control down}'`)
		case "logoff":
			cmd = exec.Command("sh", "-c", `osascript -e 'tell application "System Events" to log out'`)
		case "sleep":
			cmd = exec.Command("pmset", "sleepnow")
		}
	default:
		switch action {
		case "reboot":
			cmd = exec.Command("sh", "-c", fmt.Sprintf("sleep %d; systemctl reboot || reboot", a.DelaySeconds))
		case "shutdown":
			cmd = exec.Command("sh", "-c", fmt.Sprintf("sleep %d; systemctl poweroff || poweroff", a.DelaySeconds))
		case "lock":
			cmd = exec.Command("sh", "-c", "loginctl lock-sessions")
		case "logoff":
			cmd = exec.Command("sh", "-c", "loginctl terminate-user $(loginctl list-sessions --no-legend | awk '{print $3}' | head -1)")
		case "sleep":
			cmd = exec.Command("sh", "-c", "systemctl suspend")
		}
	}
	if cmd == nil {
		return nil, fmt.Errorf("unsupported power action %q", action)
	}
	if action == "reboot" || action == "shutdown" {
		// Detach so the result is sent before the OS goes down.
		if err := cmd.Start(); err != nil {
			return nil, err
		}
		go func() { _ = cmd.Wait() }()
		return map[string]interface{}{"scheduled": true, "delaySeconds": a.DelaySeconds, "at": time.Now().Add(time.Duration(a.DelaySeconds) * time.Second).UTC().Format(time.RFC3339)}, nil
	}
	out, err := cmd.CombinedOutput()
	c.Emit("stdout", out)
	if err != nil {
		return nil, err
	}
	return map[string]interface{}{"ok": true}, nil
}

func Reboot(ctx context.Context, c *Command) (interface{}, error)   { return power(ctx, c, "reboot") }
func Shutdown(ctx context.Context, c *Command) (interface{}, error) { return power(ctx, c, "shutdown") }
func Lock(ctx context.Context, c *Command) (interface{}, error)     { return power(ctx, c, "lock") }
func Logoff(ctx context.Context, c *Command) (interface{}, error)   { return power(ctx, c, "logoff") }
func Sleep(ctx context.Context, c *Command) (interface{}, error)    { return power(ctx, c, "sleep") }
