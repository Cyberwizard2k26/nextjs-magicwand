//go:build !windows

package sessions

import (
	"errors"
	"os"
	"os/exec"
	"os/user"
	"path/filepath"
	"strconv"
	"syscall"

	"github.com/creack/pty"

	"github.com/cyberwizard2k26/nextjs-magicwand/agent/internal/platform"
)

type unixPty struct {
	f   *os.File
	cmd *exec.Cmd
}

func (p *unixPty) Read(b []byte) (int, error)  { return p.f.Read(b) }
func (p *unixPty) Write(b []byte) (int, error) { return p.f.Write(b) }
func (p *unixPty) Resize(cols, rows int) error {
	return pty.Setsize(p.f, &pty.Winsize{Cols: uint16(cols), Rows: uint16(rows)})
}
func (p *unixPty) Pid() int { return p.cmd.Process.Pid }
func (p *unixPty) Wait() (int, error) {
	err := p.cmd.Wait()
	if p.cmd.ProcessState != nil {
		return p.cmd.ProcessState.ExitCode(), nil
	}
	return -1, err
}
func (p *unixPty) Close() error {
	if p.cmd.Process != nil {
		_ = syscall.Kill(-p.cmd.Process.Pid, syscall.SIGHUP)
	}
	return p.f.Close()
}

func pickShell(requested string) string {
	candidates := []string{}
	switch requested {
	case "bash", "zsh", "sh", "fish":
		candidates = append(candidates, requested)
	}
	candidates = append(candidates, "bash", "zsh", "sh")
	for _, c := range candidates {
		if p, err := exec.LookPath(c); err == nil {
			return p
		}
	}
	return "/bin/sh"
}

func startPty(req OpenRequest) (Pty, string, error) {
	shell := pickShell(req.Shell)
	cmd := exec.Command(shell, "-l")
	if filepath.Base(shell) == "sh" {
		cmd = exec.Command(shell)
	}
	env := append(os.Environ(), "TERM=xterm-256color", "COLORTERM=truecolor", "LANG=C.UTF-8", "MW_SESSION="+req.SessionID)
	cmd.Dir = req.Cwd
	cmd.SysProcAttr = &syscall.SysProcAttr{Setsid: true, Setctty: true}

	if req.RunAs == "user" {
		u := platform.ConsoleUser()
		if u == "" {
			return nil, "", errors.New("no interactive user is signed in")
		}
		acct, err := user.Lookup(u)
		if err != nil {
			return nil, "", err
		}
		uid, _ := strconv.Atoi(acct.Uid)
		gid, _ := strconv.Atoi(acct.Gid)
		if os.Geteuid() == 0 {
			cmd.SysProcAttr.Credential = &syscall.Credential{Uid: uint32(uid), Gid: uint32(gid)}
		}
		env = append(env, "HOME="+acct.HomeDir, "USER="+acct.Username, "LOGNAME="+acct.Username, "SHELL="+shell)
		if cmd.Dir == "" {
			cmd.Dir = acct.HomeDir
		}
	} else if cmd.Dir == "" {
		if home, err := os.UserHomeDir(); err == nil {
			cmd.Dir = home
		} else {
			cmd.Dir = "/"
		}
	}
	cmd.Env = env
	f, err := pty.StartWithSize(cmd, &pty.Winsize{Cols: uint16(req.Cols), Rows: uint16(req.Rows)})
	if err != nil {
		return nil, "", err
	}
	return &unixPty{f: f, cmd: cmd}, filepath.Base(shell), nil
}
