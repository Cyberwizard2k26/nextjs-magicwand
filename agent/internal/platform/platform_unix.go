//go:build !windows

package platform

import (
	"os/exec"
	"syscall"
)

// PrepareCommand applies OS-specific process attributes (own process group so timeouts kill children) and,
// for runAs=user, drops to the interactive user's account with their desktop environment.
func PrepareCommand(cmd *exec.Cmd, runAs string) {
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
	cmd.Cancel = func() error { return syscall.Kill(-cmd.Process.Pid, syscall.SIGKILL) }
	if runAs == "user" || runAs == "elevated_user" {
		if u := ConsoleUser(); u != "" {
			AsUser(cmd, u)
		}
	}
}
