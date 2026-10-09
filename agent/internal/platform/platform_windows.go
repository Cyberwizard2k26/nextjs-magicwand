//go:build windows

package platform

import (
	"os/exec"
	"syscall"
)

// PrepareCommand hides console windows for spawned processes. Running in the interactive user's session
// (runAs=user) is implemented by the Windows session helper (see sessions package).
func PrepareCommand(cmd *exec.Cmd, runAs string) {
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true, CreationFlags: 0x08000000 /* CREATE_NO_WINDOW */}
}
