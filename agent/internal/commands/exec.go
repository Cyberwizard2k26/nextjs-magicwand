package commands

import (
	"bufio"
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"time"

	"github.com/cyberwizard2k26/nextjs-magicwand/agent/internal/platform"
)

// Shell returns the default shell + flag for this OS.
func defaultShell() (string, []string) {
	switch runtime.GOOS {
	case "windows":
		return "powershell.exe", []string{"-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command"}
	default:
		if _, err := exec.LookPath("bash"); err == nil {
			return "bash", []string{"-c"}
		}
		return "sh", []string{"-c"}
	}
}

func interpreter(language string) (string, []string, string, error) {
	switch strings.ToLower(language) {
	case "powershell", "pwsh":
		if runtime.GOOS == "windows" {
			if _, err := exec.LookPath("pwsh.exe"); err == nil && language == "pwsh" {
				return "pwsh.exe", []string{"-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File"}, ".ps1", nil
			}
			return "powershell.exe", []string{"-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File"}, ".ps1", nil
		}
		if p, err := exec.LookPath("pwsh"); err == nil {
			return p, []string{"-NoProfile", "-NonInteractive", "-File"}, ".ps1", nil
		}
		return "", nil, "", errors.New("PowerShell is not installed on this device")
	case "bash":
		return "bash", []string{}, ".sh", nil
	case "sh":
		return "sh", []string{}, ".sh", nil
	case "zsh":
		return "zsh", []string{}, ".zsh", nil
	case "python", "python3":
		for _, p := range []string{"python3", "python"} {
			if _, err := exec.LookPath(p); err == nil {
				return p, []string{}, ".py", nil
			}
		}
		return "", nil, "", errors.New("Python is not installed on this device")
	case "cmd", "batch":
		if runtime.GOOS != "windows" {
			return "", nil, "", errors.New("cmd scripts only run on Windows")
		}
		return "cmd.exe", []string{"/c"}, ".cmd", nil
	case "node", "javascript":
		if _, err := exec.LookPath("node"); err == nil {
			return "node", []string{}, ".js", nil
		}
		return "", nil, "", errors.New("Node.js is not installed on this device")
	case "applescript":
		if runtime.GOOS != "darwin" {
			return "", nil, "", errors.New("AppleScript only runs on macOS")
		}
		return "osascript", []string{}, ".scpt", nil
	}
	return "", nil, "", fmt.Errorf("unsupported language %q", language)
}

// runProcess executes a command, streaming output through c.Emit, and records the exit code.
func runProcess(ctx context.Context, c *Command, name string, args []string, env []string, cwd string, stdin string) error {
	cmd := exec.CommandContext(ctx, name, args...)
	if cwd != "" {
		cmd.Dir = cwd
	}
	cmd.Env = append(os.Environ(), env...)
	platform.PrepareCommand(cmd, c.RunAs)
	if stdin != "" {
		cmd.Stdin = strings.NewReader(stdin)
	}
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return err
	}
	stderr, err := cmd.StderrPipe()
	if err != nil {
		return err
	}
	if err := cmd.Start(); err != nil {
		return err
	}
	var wg sync.WaitGroup
	pump := func(r io.Reader, stream string) {
		defer wg.Done()
		br := bufio.NewReaderSize(r, 32*1024)
		buf := make([]byte, 16*1024)
		for {
			n, err := br.Read(buf)
			if n > 0 {
				c.Emit(stream, append([]byte(nil), buf[:n]...))
			}
			if err != nil {
				return
			}
		}
	}
	wg.Add(2)
	go pump(stdout, "stdout")
	go pump(stderr, "stderr")
	wg.Wait()
	err = cmd.Wait()
	if cmd.ProcessState != nil {
		c.SetExitCode(cmd.ProcessState.ExitCode())
	}
	if ctx.Err() != nil {
		return ctx.Err()
	}
	var exitErr *exec.ExitError
	if errors.As(err, &exitErr) {
		return nil // non-zero exit is reported via exit code, not as an execution error
	}
	return err
}

// RunCommand: { command, shell?, cwd?, env? }
func RunCommand(ctx context.Context, c *Command) (interface{}, error) {
	var a struct {
		Command string            `json:"command"`
		Shell   string            `json:"shell"`
		Cwd     string            `json:"cwd"`
		Env     map[string]string `json:"env"`
	}
	if err := c.Arg(&a); err != nil {
		return nil, err
	}
	if strings.TrimSpace(a.Command) == "" {
		return nil, errors.New("command is required")
	}
	shell, flags := defaultShell()
	switch strings.ToLower(a.Shell) {
	case "cmd":
		if runtime.GOOS == "windows" {
			shell, flags = "cmd.exe", []string{"/c"}
		}
	case "bash":
		shell, flags = "bash", []string{"-c"}
	case "sh":
		shell, flags = "sh", []string{"-c"}
	case "zsh":
		shell, flags = "zsh", []string{"-c"}
	case "pwsh":
		if _, err := exec.LookPath("pwsh"); err == nil {
			shell, flags = "pwsh", []string{"-NoProfile", "-NonInteractive", "-Command"}
		}
	}
	var env []string
	for k, v := range a.Env {
		env = append(env, k+"="+v)
	}
	return nil, runProcess(ctx, c, shell, append(flags, a.Command), env, a.Cwd, "")
}

// RunScript: { language, content, params?, outputJson?, builtin? }
func RunScript(ctx context.Context, c *Command) (interface{}, error) {
	var a struct {
		Language   string                 `json:"language"`
		Content    string                 `json:"content"`
		Params     map[string]interface{} `json:"params"`
		OutputJSON bool                   `json:"outputJson"`
		Builtin    string                 `json:"builtin"`
		Cwd        string                 `json:"cwd"`
	}
	if err := c.Arg(&a); err != nil {
		return nil, err
	}
	if a.Builtin != "" {
		if b, ok := Builtins[a.Builtin]; ok {
			a.Language, a.Content = b.language(), b.content()
		} else {
			return nil, fmt.Errorf("unknown builtin script %q", a.Builtin)
		}
	}
	if a.Language == "" {
		if runtime.GOOS == "windows" {
			a.Language = "powershell"
		} else {
			a.Language = "bash"
		}
	}
	bin, flags, ext, err := interpreter(a.Language)
	if err != nil {
		return nil, err
	}
	dir, err := os.MkdirTemp("", "mw-script-")
	if err != nil {
		return nil, err
	}
	defer os.RemoveAll(dir)
	path := filepath.Join(dir, "script"+ext)
	content := a.Content
	if runtime.GOOS == "windows" && (ext == ".ps1" || ext == ".cmd") {
		content = strings.ReplaceAll(content, "\r\n", "\n")
		content = strings.ReplaceAll(content, "\n", "\r\n")
	}
	if err := os.WriteFile(path, []byte(content), 0o700); err != nil {
		return nil, err
	}
	var env []string
	for k, v := range a.Params {
		env = append(env, "MW_PARAM_"+strings.ToUpper(k)+"="+fmt.Sprint(v))
	}
	env = append(env, "MW_AGENT=1")
	args := append(append([]string{}, flags...), path)
	if a.Language == "cmd" || a.Language == "batch" {
		args = []string{"/c", path}
	}
	// Positional/named params are also passed as arguments for languages that support them.
	for k, v := range a.Params {
		if ext == ".ps1" {
			args = append(args, "-"+k, fmt.Sprint(v))
		} else {
			args = append(args, fmt.Sprint(v))
		}
	}
	err = runProcess(ctx, c, bin, args, env, a.Cwd, "")
	if err != nil {
		return nil, err
	}
	if a.OutputJSON {
		c.mu.Lock()
		out := strings.TrimSpace(string(c.stdout))
		c.mu.Unlock()
		if i := strings.LastIndex(out, "\n{"); i >= 0 {
			out = out[i+1:]
		}
		var v interface{}
		if jsonErr := jsonUnmarshal([]byte(out), &v); jsonErr == nil {
			return v, nil
		}
	}
	return nil, nil
}

// Builtins are scripts shipped with the agent (used by jobs such as clear_cache).
type builtin struct {
	win, nix string
}

func (b builtin) language() string {
	if runtime.GOOS == "windows" {
		return "powershell"
	}
	return "bash"
}
func (b builtin) content() string {
	if runtime.GOOS == "windows" {
		return b.win
	}
	return b.nix
}

var Builtins = map[string]builtin{
	"clear_cache": {
		win: `$ErrorActionPreference='SilentlyContinue'; Remove-Item "$env:TEMP\*" -Recurse -Force; Remove-Item "C:\Windows\Temp\*" -Recurse -Force; Clear-RecycleBin -Force; Get-ChildItem 'C:\Users\*\AppData\Local\Microsoft\Windows\INetCache' | Remove-Item -Recurse -Force; Write-Output "Temporary files cleared"`,
		nix: `set -e; rm -rf /tmp/* /var/tmp/* 2>/dev/null || true; if command -v apt-get >/dev/null; then apt-get clean; fi; if command -v dnf >/dev/null; then dnf clean all; fi; if command -v journalctl >/dev/null; then journalctl --vacuum-size=200M; fi; echo "Temporary files cleared"`,
	},
}

func init() {
	_ = time.Now
}
