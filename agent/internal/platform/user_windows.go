//go:build windows

package platform

import (
	"errors"
	"fmt"
	"os/exec"
	"syscall"
	"unsafe"

	"golang.org/x/sys/windows"
)

// InteractiveUserToken returns a primary token for the user signed in at the physical console. The agent
// runs as LocalSystem, which is allowed to call WTSQueryUserToken; the token is what lets commands,
// terminals, screenshots and dialogs run on the user's desktop instead of in session 0.
func InteractiveUserToken() (windows.Token, error) {
	sid := windows.WTSGetActiveConsoleSessionId()
	if sid == 0xFFFFFFFF {
		return 0, errors.New("no user is signed in at the console")
	}
	var impersonation windows.Token
	if err := windows.WTSQueryUserToken(sid, &impersonation); err != nil {
		return 0, fmt.Errorf("query user token (agent must run as LocalSystem): %w", err)
	}
	defer impersonation.Close()
	var primary windows.Token
	if err := windows.DuplicateTokenEx(impersonation, windows.MAXIMUM_ALLOWED, nil, windows.SecurityIdentification, windows.TokenPrimary, &primary); err != nil {
		return 0, err
	}
	return primary, nil
}

// UserProfileDir resolves %USERPROFILE% for a token.
func UserProfileDir(token windows.Token) string {
	dir, err := token.GetUserProfileDirectory()
	if err != nil {
		return ""
	}
	return dir
}

// ConsoleUser returns DOMAIN\user for the console session, or "".
func ConsoleUser() string {
	t, err := InteractiveUserToken()
	if err != nil {
		return ""
	}
	defer t.Close()
	u, err := t.GetTokenUser()
	if err != nil {
		return ""
	}
	name, domain, _, err := u.User.Sid.LookupAccount("")
	if err != nil {
		return ""
	}
	if domain != "" {
		return domain + `\` + name
	}
	return name
}

// AsUser makes cmd run in the interactive user's session with their token and environment.
func AsUser(cmd *exec.Cmd, _ string) bool {
	token, err := InteractiveUserToken()
	if err != nil {
		return false
	}
	if cmd.SysProcAttr == nil {
		cmd.SysProcAttr = &syscall.SysProcAttr{}
	}
	cmd.SysProcAttr.Token = syscall.Token(token)
	var block *uint16
	if err := windows.CreateEnvironmentBlock(&block, token, false); err == nil {
		cmd.Env = append(envBlockToSlice(block), cmd.Env...)
		windows.DestroyEnvironmentBlock(block)
	}
	if cmd.Dir == "" {
		cmd.Dir = UserProfileDir(token)
	}
	// The token is closed by the OS when the process handle is released; Go keeps it for StartProcess.
	return true
}

func envBlockToSlice(block *uint16) []string {
	var out []string
	p := unsafe.Pointer(block)
	for {
		s := windows.UTF16PtrToString((*uint16)(p))
		if s == "" {
			break
		}
		out = append(out, s)
		p = unsafe.Pointer(uintptr(p) + uintptr(2*(len(syscall.StringToUTF16(s)))))
	}
	return out
}
