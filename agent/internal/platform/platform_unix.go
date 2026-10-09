//go:build !windows

package platform

import (
	"os/exec"
	"syscall"
)

// PrepareCommand applies OS-specific process attributes (own process group so timeouts kill children).
func PrepareCommand(cmd *exec.Cmd, runAs string) {
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
	cmd.Cancel = func() error { return syscall.Kill(-cmd.Process.Pid, syscall.SIGKILL) }
}
