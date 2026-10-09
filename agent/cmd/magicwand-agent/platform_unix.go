//go:build !windows

package main

import (
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"

	"github.com/cyberwizard2k26/nextjs-magicwand/agent/internal/commands"
	"github.com/cyberwizard2k26/nextjs-magicwand/agent/internal/config"
)

func isElevated() bool { return os.Geteuid() == 0 }

func relaunchElevated() bool { return false }

func installPath() string {
	if runtime.GOOS == "darwin" {
		return "/Library/Application Support/MagicWand/Agent/magicwand-agent"
	}
	return "/usr/local/bin/magicwand-agent"
}

func notifyInstalled(cfg *config.Config, msg string) {
	if runtime.GOOS == "darwin" && cfg.ConsoleURL != "" {
		_ = exec.Command("osascript", "-e", `display notification "`+strings.ReplaceAll(msg, `"`, `'`)+`" with title "`+cfg.ProductName+`"`).Run()
	}
}

func pendingReboot() (bool, bool) {
	if runtime.GOOS == "linux" {
		if _, err := os.Stat("/var/run/reboot-required"); err == nil {
			return true, true
		}
		if _, err := os.Stat("/run/reboot-required"); err == nil {
			return true, true
		}
		if m, _ := filepath.Glob("/boot/vmlinuz-*"); len(m) > 0 {
			return false, true
		}
	}
	return false, false
}

func registerPlatformCommands(a *Agent, d *commands.Dispatcher) {}

// platformCapabilities lists features that only exist on this OS.
func platformCapabilities() []string {
	if runtime.GOOS == "linux" {
		return []string{"session_unlock"}
	}
	return nil
}
