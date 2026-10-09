//go:build windows

package main

import (
	"os"
	"path/filepath"
	"strings"
	"syscall"
	"unsafe"

	"golang.org/x/sys/windows"
	"golang.org/x/sys/windows/registry"

	"github.com/cyberwizard2k26/nextjs-magicwand/agent/internal/commands"
	"github.com/cyberwizard2k26/nextjs-magicwand/agent/internal/config"
)

func isElevated() bool {
	var sid *windows.SID
	if err := windows.AllocateAndInitializeSid(&windows.SECURITY_NT_AUTHORITY, 2, windows.SECURITY_BUILTIN_DOMAIN_RID, windows.DOMAIN_ALIAS_RID_ADMINS, 0, 0, 0, 0, 0, 0, &sid); err != nil {
		return false
	}
	defer windows.FreeSid(sid)
	token := windows.Token(0)
	member, err := token.IsMember(sid)
	return err == nil && member
}

// relaunchElevated re-runs the current command through UAC ("runas").
func relaunchElevated() bool {
	exe, err := os.Executable()
	if err != nil {
		return false
	}
	verb, _ := syscall.UTF16PtrFromString("runas")
	exePtr, _ := syscall.UTF16PtrFromString(exe)
	args, _ := syscall.UTF16PtrFromString(strings.Join(os.Args[1:], " "))
	cwd, _ := syscall.UTF16PtrFromString(filepath.Dir(exe))
	err = windows.ShellExecute(0, verb, exePtr, args, cwd, windows.SW_SHOWNORMAL)
	return err == nil
}

func installPath() string {
	base := os.Getenv("ProgramFiles")
	if base == "" {
		base = `C:\Program Files`
	}
	return filepath.Join(base, "MagicWand", "Agent", "magicwand-agent.exe")
}

var (
	user32         = windows.NewLazySystemDLL("user32.dll")
	procMessageBox = user32.NewProc("MessageBoxW")
)

func notifyInstalled(cfg *config.Config, msg string) {
	// Only show a dialog when launched interactively (double-click), not from msiexec or scripts.
	if os.Getenv("MW_SILENT") != "" || os.Getenv("PROMPT") != "" {
		return
	}
	text, _ := syscall.UTF16PtrFromString(msg)
	title, _ := syscall.UTF16PtrFromString(cfg.ProductName + " Agent")
	procMessageBox.Call(0, uintptr(unsafe.Pointer(text)), uintptr(unsafe.Pointer(title)), 0x40)
}

func pendingReboot() (bool, bool) {
	for _, k := range []string{
		`SOFTWARE\Microsoft\Windows\CurrentVersion\Component Based Servicing\RebootPending`,
		`SOFTWARE\Microsoft\Windows\CurrentVersion\WindowsUpdate\Auto Update\RebootRequired`,
	} {
		if key, err := registry.OpenKey(registry.LOCAL_MACHINE, k, registry.QUERY_VALUE); err == nil {
			key.Close()
			return true, true
		}
	}
	if key, err := registry.OpenKey(registry.LOCAL_MACHINE, `SYSTEM\CurrentControlSet\Control\Session Manager`, registry.QUERY_VALUE); err == nil {
		defer key.Close()
		if v, _, err := key.GetStringsValue("PendingFileRenameOperations"); err == nil && len(v) > 0 {
			return true, true
		}
	}
	return false, true
}

func registerPlatformCommands(a *Agent, d *commands.Dispatcher) {}

// platformCapabilities lists features that only exist on this OS.
func platformCapabilities() []string { return []string{"registry"} }
