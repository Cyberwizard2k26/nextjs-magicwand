package commands

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os/exec"
	"runtime"
	"strings"

	"github.com/cyberwizard2k26/nextjs-magicwand/agent/internal/platform"
)

// Shared plumbing for the IT command set (services, users, logs, tasks, patches, software, desktop).

func unsupported(feature string) error {
	return fmt.Errorf("%s is not supported on %s by this agent build", feature, osLabel())
}

func osLabel() string {
	switch runtime.GOOS {
	case "windows":
		return "Windows"
	case "darwin":
		return "macOS"
	default:
		return runtime.GOOS
	}
}

// runOut runs a program and returns trimmed combined output; a non-zero exit becomes an error that
// includes the output so technicians see what the OS said.
func runOut(ctx context.Context, name string, args ...string) (string, error) {
	cmd := exec.CommandContext(ctx, name, args...)
	platform.PrepareCommand(cmd, "")
	out, err := cmd.CombinedOutput()
	s := strings.TrimSpace(string(out))
	if err != nil {
		if s != "" {
			return s, fmt.Errorf("%s: %s", name, firstLines(s, 6))
		}
		return s, fmt.Errorf("%s: %w", name, err)
	}
	return s, nil
}

// runOutAs runs a program in the interactive user's context (desktop, environment, identity).
func runOutAs(ctx context.Context, runAs string, name string, args ...string) (string, error) {
	cmd := exec.CommandContext(ctx, name, args...)
	platform.PrepareCommand(cmd, runAs)
	out, err := cmd.CombinedOutput()
	s := strings.TrimSpace(string(out))
	if err != nil {
		if s != "" {
			return s, fmt.Errorf("%s: %s", name, firstLines(s, 6))
		}
		return s, fmt.Errorf("%s: %w", name, err)
	}
	return s, nil
}

// runStdin runs a program feeding stdin (used to keep passwords and scripts out of argv).
func runStdin(ctx context.Context, stdin string, runAs string, name string, args ...string) (string, error) {
	cmd := exec.CommandContext(ctx, name, args...)
	platform.PrepareCommand(cmd, runAs)
	cmd.Stdin = strings.NewReader(stdin)
	out, err := cmd.CombinedOutput()
	s := strings.TrimSpace(string(out))
	if err != nil {
		if s != "" {
			return s, fmt.Errorf("%s: %s", name, firstLines(s, 6))
		}
		return s, fmt.Errorf("%s: %w", name, err)
	}
	return s, nil
}

func firstLines(s string, n int) string {
	lines := strings.Split(s, "\n")
	if len(lines) > n {
		lines = lines[:n]
	}
	return strings.TrimSpace(strings.Join(lines, "\n"))
}

// ps runs a PowerShell script read from stdin (never from argv) and returns its output.
func ps(ctx context.Context, script string, runAs string) (string, error) {
	exe := "powershell.exe"
	if runtime.GOOS != "windows" {
		if p, err := exec.LookPath("pwsh"); err == nil {
			exe = p
		} else {
			return "", unsupported("PowerShell")
		}
	}
	full := "$ErrorActionPreference='Stop'; [Console]::OutputEncoding=[System.Text.Encoding]::UTF8\n" + script + "\n"
	return runStdin(ctx, full, runAs, exe, "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", "-")
}

// psJSON runs a PowerShell script that ends in ConvertTo-Json and decodes the result (object or array).
func psJSON(ctx context.Context, script string, runAs string) ([]map[string]interface{}, error) {
	out, err := ps(ctx, script, runAs)
	if err != nil {
		return nil, err
	}
	return decodeJSONRows(out)
}

// decodeJSONRows accepts a JSON array, a single object, or nothing.
func decodeJSONRows(out string) ([]map[string]interface{}, error) {
	out = strings.TrimSpace(out)
	if out == "" || out == "null" {
		return []map[string]interface{}{}, nil
	}
	dec := json.NewDecoder(bytes.NewReader([]byte(out)))
	dec.UseNumber()
	var any interface{}
	if err := dec.Decode(&any); err != nil {
		return nil, fmt.Errorf("could not parse output as JSON: %s", firstLines(out, 3))
	}
	switch v := any.(type) {
	case []interface{}:
		rows := make([]map[string]interface{}, 0, len(v))
		for _, x := range v {
			if m, ok := x.(map[string]interface{}); ok {
				rows = append(rows, m)
			}
		}
		return rows, nil
	case map[string]interface{}:
		return []map[string]interface{}{v}, nil
	}
	return nil, errors.New("unexpected JSON shape")
}

// psq quotes a string for a single-quoted PowerShell literal.
func psq(s string) string { return "'" + strings.ReplaceAll(s, "'", "''") + "'" }

// shq quotes a string for a POSIX shell.
func shq(s string) string { return "'" + strings.ReplaceAll(s, "'", `'\''`) + "'" }

func str(m map[string]interface{}, k string) string {
	if v, ok := m[k]; ok && v != nil {
		switch t := v.(type) {
		case string:
			return t
		case json.Number:
			return t.String()
		default:
			return fmt.Sprint(t)
		}
	}
	return ""
}

func num(m map[string]interface{}, k string) float64 {
	switch t := m[k].(type) {
	case json.Number:
		f, _ := t.Float64()
		return f
	case float64:
		return t
	case int:
		return float64(t)
	}
	return 0
}

func boolean(m map[string]interface{}, k string) bool {
	switch t := m[k].(type) {
	case bool:
		return t
	case string:
		return strings.EqualFold(t, "true")
	}
	return false
}

func has(name string) bool {
	_, err := exec.LookPath(name)
	return err == nil
}

// consoleUser is the user signed in at the physical console ("" when nobody).
func consoleUser() string { return platform.ConsoleUser() }
