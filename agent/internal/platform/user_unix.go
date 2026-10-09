//go:build !windows

package platform

import (
	"os"
	"os/exec"
	"os/user"
	"runtime"
	"strconv"
	"strings"
	"syscall"
)

// ConsoleUser returns the user owning the interactive session (best effort): the macOS console owner,
// the owner of a seat/graphical session on Linux, or the first user with a tty.
func ConsoleUser() string {
	if runtime.GOOS == "darwin" {
		if out, err := exec.Command("stat", "-f", "%Su", "/dev/console").Output(); err == nil {
			u := strings.TrimSpace(string(out))
			if u != "" && u != "root" && u != "_mbsetupuser" {
				return u
			}
		}
	}
	if out, err := exec.Command("loginctl", "list-sessions", "--no-legend").Output(); err == nil {
		for _, line := range strings.Split(string(out), "\n") {
			f := strings.Fields(line)
			if len(f) >= 3 && f[2] != "root" && f[2] != "" {
				return f[2]
			}
		}
	}
	if out, err := exec.Command("who").Output(); err == nil {
		for _, line := range strings.Split(string(out), "\n") {
			f := strings.Fields(line)
			if len(f) >= 1 && f[0] != "root" && f[0] != "" {
				return f[0]
			}
		}
	}
	if u := os.Getenv("SUDO_USER"); u != "" {
		return u
	}
	return ""
}

// AsUser configures cmd to run as the given account (only effective when the agent is root) with the
// environment a login shell would expect. Returns false when the account is unknown.
func AsUser(cmd *exec.Cmd, username string) bool {
	acct, err := user.Lookup(username)
	if err != nil {
		return false
	}
	uid, _ := strconv.Atoi(acct.Uid)
	gid, _ := strconv.Atoi(acct.Gid)
	if cmd.SysProcAttr == nil {
		cmd.SysProcAttr = &syscall.SysProcAttr{}
	}
	if os.Geteuid() == 0 {
		cmd.SysProcAttr.Credential = &syscall.Credential{Uid: uint32(uid), Gid: uint32(gid)}
	}
	env := []string{"HOME=" + acct.HomeDir, "USER=" + acct.Username, "LOGNAME=" + acct.Username, "PATH=" + os.Getenv("PATH"), "LANG=C.UTF-8"}
	// Desktop session plumbing so notifications and screenshots reach the user's display.
	if runtime.GOOS == "linux" {
		env = append(env, "DISPLAY="+displayFor(acct.Username), "XDG_RUNTIME_DIR=/run/user/"+acct.Uid, "DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/"+acct.Uid+"/bus")
		if wl := waylandFor(acct.Uid); wl != "" {
			env = append(env, "WAYLAND_DISPLAY="+wl)
		}
	}
	cmd.Env = append(env, cmd.Env...)
	if cmd.Dir == "" {
		cmd.Dir = acct.HomeDir
	}
	return true
}

func displayFor(username string) string {
	if out, err := exec.Command("who").Output(); err == nil {
		for _, line := range strings.Split(string(out), "\n") {
			if strings.HasPrefix(line, username+" ") && strings.Contains(line, "(:") {
				i := strings.Index(line, "(:")
				return strings.TrimSuffix(line[i+1:], ")")
			}
		}
	}
	return ":0"
}

func waylandFor(uid string) string {
	entries, err := os.ReadDir("/run/user/" + uid)
	if err != nil {
		return ""
	}
	for _, e := range entries {
		if strings.HasPrefix(e.Name(), "wayland-") && !strings.HasSuffix(e.Name(), ".lock") {
			return e.Name()
		}
	}
	return ""
}
