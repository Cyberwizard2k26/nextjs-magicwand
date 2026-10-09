//go:build windows

package sessions

import (
	"errors"
	"fmt"
	"os"
	"os/exec"
	"strings"
	"sync"
	"unsafe"

	"golang.org/x/sys/windows"

	"github.com/cyberwizard2k26/nextjs-magicwand/agent/internal/platform"
)

// conPty drives a Windows pseudo console (ConPTY, Windows 10 1809+). The shell reads keystrokes from
// inW and writes rendered output to outR; the console host does the VT translation in between.
type conPty struct {
	hpc    windows.Handle
	inW    *os.File
	outR   *os.File
	proc   windows.Handle
	pid    int
	once   sync.Once
	closed bool
}

func (p *conPty) Read(b []byte) (int, error)  { return p.outR.Read(b) }
func (p *conPty) Write(b []byte) (int, error) { return p.inW.Write(b) }
func (p *conPty) Pid() int                    { return p.pid }
func (p *conPty) Resize(cols, rows int) error {
	return windows.ResizePseudoConsole(p.hpc, windows.Coord{X: int16(cols), Y: int16(rows)})
}
func (p *conPty) Wait() (int, error) {
	if _, err := windows.WaitForSingleObject(p.proc, windows.INFINITE); err != nil {
		return -1, err
	}
	var code uint32
	if err := windows.GetExitCodeProcess(p.proc, &code); err != nil {
		return -1, err
	}
	return int(code), nil
}
func (p *conPty) Close() error {
	p.once.Do(func() {
		_ = windows.TerminateProcess(p.proc, 1)
		windows.ClosePseudoConsole(p.hpc)
		_ = p.inW.Close()
		_ = p.outR.Close()
		_ = windows.CloseHandle(p.proc)
		p.closed = true
	})
	return nil
}

func pickShell(requested string) (string, []string) {
	switch requested {
	case "cmd":
		return "cmd.exe", []string{}
	case "pwsh":
		if p, err := exec.LookPath("pwsh.exe"); err == nil {
			return p, []string{"-NoLogo"}
		}
	}
	return "powershell.exe", []string{"-NoLogo", "-NoExit", "-ExecutionPolicy", "Bypass"}
}

func startPty(req OpenRequest) (Pty, string, error) {
	shell, args := pickShell(req.Shell)
	exe, err := exec.LookPath(shell)
	if err != nil {
		return nil, "", err
	}
	var inR, inW, outR, outW windows.Handle
	if err := windows.CreatePipe(&inR, &inW, nil, 0); err != nil {
		return nil, "", fmt.Errorf("pipe: %w", err)
	}
	if err := windows.CreatePipe(&outR, &outW, nil, 0); err != nil {
		return nil, "", fmt.Errorf("pipe: %w", err)
	}
	var hpc windows.Handle
	if err := windows.CreatePseudoConsole(windows.Coord{X: int16(req.Cols), Y: int16(req.Rows)}, inR, outW, 0, &hpc); err != nil {
		return nil, "", fmt.Errorf("ConPTY is not available on this Windows build (needs Windows 10 1809 or later): %w", err)
	}
	attrs, err := windows.NewProcThreadAttributeList(1)
	if err != nil {
		windows.ClosePseudoConsole(hpc)
		return nil, "", err
	}
	defer attrs.Delete()
	if err := attrs.Update(windows.PROC_THREAD_ATTRIBUTE_PSEUDOCONSOLE, unsafe.Pointer(hpc), unsafe.Sizeof(hpc)); err != nil {
		windows.ClosePseudoConsole(hpc)
		return nil, "", err
	}
	si := new(windows.StartupInfoEx)
	si.Cb = uint32(unsafe.Sizeof(*si))
	si.ProcThreadAttributeList = attrs.List()
	cmdline := windows.EscapeArg(exe)
	for _, a := range args {
		cmdline += " " + windows.EscapeArg(a)
	}
	cmdPtr, _ := windows.UTF16PtrFromString(cmdline)
	var dirPtr *uint16
	if req.Cwd != "" {
		dirPtr, _ = windows.UTF16PtrFromString(req.Cwd)
	}
	var pi windows.ProcessInformation
	flags := uint32(windows.EXTENDED_STARTUPINFO_PRESENT | windows.CREATE_UNICODE_ENVIRONMENT)

	var token windows.Token
	if req.RunAs == "user" {
		t, terr := platform.InteractiveUserToken()
		if terr != nil {
			windows.ClosePseudoConsole(hpc)
			return nil, "", terr
		}
		token = t
		defer token.Close()
	}
	var envBlock *uint16
	if token != 0 {
		if err := windows.CreateEnvironmentBlock(&envBlock, token, false); err == nil {
			defer windows.DestroyEnvironmentBlock(envBlock)
		} else {
			envBlock = nil
		}
		if dirPtr == nil {
			if home := platform.UserProfileDir(token); home != "" {
				dirPtr, _ = windows.UTF16PtrFromString(home)
			}
		}
		err = windows.CreateProcessAsUser(token, nil, cmdPtr, nil, nil, false, flags, envBlock, dirPtr, &si.StartupInfo, &pi)
	} else {
		err = windows.CreateProcess(nil, cmdPtr, nil, nil, false, flags, nil, dirPtr, &si.StartupInfo, &pi)
	}
	_ = windows.CloseHandle(inR)
	_ = windows.CloseHandle(outW)
	if err != nil {
		windows.ClosePseudoConsole(hpc)
		_ = windows.CloseHandle(inW)
		_ = windows.CloseHandle(outR)
		return nil, "", fmt.Errorf("start %s: %w", shell, err)
	}
	_ = windows.CloseHandle(pi.Thread)
	p := &conPty{hpc: hpc, inW: os.NewFile(uintptr(inW), "conpty-in"), outR: os.NewFile(uintptr(outR), "conpty-out"), proc: pi.Process, pid: int(pi.ProcessId)}
	name := strings.TrimSuffix(strings.ToLower(shell), ".exe")
	if name == "" {
		return nil, "", errors.New("no shell")
	}
	return p, name, nil
}
