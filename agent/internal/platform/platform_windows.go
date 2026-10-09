//go:build windows

package platform

import (
	"os/exec"
	"syscall"
)

// PrepareCommand hides console windows for spawned processes and, for runAs=user, runs the process with
// the console user's token so it lands on their desktop (dialogs, screenshots, per-user settings).
func PrepareCommand(cmd *exec.Cmd, runAs string) {
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true, CreationFlags: 0x08000000 /* CREATE_NO_WINDOW */}
	if runAs == "user" || runAs == "elevated_user" {
		AsUser(cmd, "")
	}
}
