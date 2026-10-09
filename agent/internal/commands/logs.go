package commands

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"runtime"
	"strconv"
	"strings"
	"time"

	"github.com/cyberwizard2k26/nextjs-magicwand/agent/internal/platform"
)

type logEntry struct {
	TS      string `json:"ts"`
	Level   string `json:"level"`
	Source  string `json:"source,omitempty"`
	ID      string `json:"id,omitempty"`
	Message string `json:"message"`
}

// EventLogQuery: { source?, level?: error|warning|info, limit?, sinceMinutes?, search? }
//   Windows: source = log name (System, Application, Security, Setup, or any channel)
//   Linux:   source = systemd unit (journalctl -u) or empty for everything
//   macOS:   source = process name
func EventLogQuery(ctx context.Context, c *Command) (interface{}, error) {
	var a struct {
		Source       string `json:"source"`
		Level        string `json:"level"`
		Limit        int    `json:"limit"`
		SinceMinutes int    `json:"sinceMinutes"`
		Search       string `json:"search"`
	}
	if err := c.Arg(&a); err != nil {
		return nil, err
	}
	if a.Limit <= 0 || a.Limit > 1000 {
		a.Limit = 200
	}
	if strings.ContainsAny(a.Source, "\n\r\"'`$;|&") {
		return nil, fmt.Errorf("invalid source")
	}
	var entries []logEntry
	var err error
	switch runtime.GOOS {
	case "windows":
		entries, err = windowsEvents(ctx, a.Source, a.Level, a.Limit, a.SinceMinutes, a.Search)
	case "darwin":
		entries, err = macLogs(ctx, a.Source, a.Level, a.Limit, a.SinceMinutes, a.Search)
	default:
		entries, err = linuxLogs(ctx, a.Source, a.Level, a.Limit, a.SinceMinutes, a.Search)
	}
	if err != nil {
		return nil, err
	}
	if entries == nil {
		entries = []logEntry{}
	}
	return map[string]interface{}{"entries": entries, "count": len(entries)}, nil
}

func windowsEvents(ctx context.Context, source, level string, limit, since int, search string) ([]logEntry, error) {
	if source == "" {
		source = "System"
	}
	filter := "@{LogName=" + psq(source) + "}"
	switch level {
	case "error":
		filter = "@{LogName=" + psq(source) + "; Level=@(1,2)}"
	case "warning":
		filter = "@{LogName=" + psq(source) + "; Level=@(1,2,3)}"
	}
	if since > 0 {
		filter = strings.TrimSuffix(filter, "}") + "; StartTime=(Get-Date).AddMinutes(-" + strconv.Itoa(since) + ")}"
	}
	where := ""
	if search != "" {
		where = " | Where-Object { $_.Message -like " + psq("*"+search+"*") + " -or $_.ProviderName -like " + psq("*"+search+"*") + " }"
	}
	script := "Get-WinEvent -FilterHashtable " + filter + " -MaxEvents " + strconv.Itoa(limit*2) + " -ErrorAction SilentlyContinue" + where + " | Select-Object -First " + strconv.Itoa(limit) +
		` | Select-Object @{n='ts';e={$_.TimeCreated.ToUniversalTime().ToString('o')}}, @{n='level';e={$_.LevelDisplayName}}, @{n='source';e={$_.ProviderName}}, @{n='id';e={[string]$_.Id}}, @{n='message';e={ if($_.Message){ $_.Message.Substring(0,[Math]::Min(2000,$_.Message.Length)) } else { '' } }} | ConvertTo-Json -Compress`
	rows, err := psJSON(ctx, script, "")
	if err != nil {
		return nil, err
	}
	out := make([]logEntry, 0, len(rows))
	for _, r := range rows {
		lvl := strings.ToLower(str(r, "level"))
		switch lvl {
		case "critical", "error":
			lvl = "error"
		case "warning":
		case "":
			lvl = "info"
		default:
			lvl = "info"
		}
		out = append(out, logEntry{TS: str(r, "ts"), Level: lvl, Source: str(r, "source"), ID: str(r, "id"), Message: str(r, "message")})
	}
	return out, nil
}

func linuxLogs(ctx context.Context, unit, level string, limit, since int, search string) ([]logEntry, error) {
	if has("journalctl") {
		args := []string{"-o", "json", "-n", strconv.Itoa(limit), "--no-pager", "-q"}
		switch level {
		case "error":
			args = append(args, "-p", "0..3")
		case "warning":
			args = append(args, "-p", "0..4")
		}
		if since > 0 {
			args = append(args, "--since", "-"+strconv.Itoa(since)+"min")
		}
		if unit != "" {
			args = append(args, "-u", unit)
		}
		if search != "" {
			args = append(args, "-g", search)
		}
		cmd := exec.CommandContext(ctx, "journalctl", args...)
		platform.PrepareCommand(cmd, "")
		raw, err := cmd.Output()
		if err == nil {
			var out []logEntry
			sc := bufio.NewScanner(strings.NewReader(string(raw)))
			sc.Buffer(make([]byte, 1024*1024), 4*1024*1024)
			for sc.Scan() {
				var m map[string]interface{}
				if json.Unmarshal(sc.Bytes(), &m) != nil {
					continue
				}
				ts := ""
				if us, err := strconv.ParseInt(str(m, "__REALTIME_TIMESTAMP"), 10, 64); err == nil {
					ts = time.UnixMicro(us).UTC().Format(time.RFC3339)
				}
				prio, _ := strconv.Atoi(str(m, "PRIORITY"))
				lvl := "info"
				if prio <= 3 {
					lvl = "error"
				} else if prio == 4 {
					lvl = "warning"
				} else if prio >= 7 {
					lvl = "debug"
				}
				src := str(m, "SYSLOG_IDENTIFIER")
				if src == "" {
					src = str(m, "_SYSTEMD_UNIT")
				}
				msg := str(m, "MESSAGE")
				if len(msg) > 2000 {
					msg = msg[:2000]
				}
				out = append(out, logEntry{TS: ts, Level: lvl, Source: src, ID: str(m, "_PID"), Message: msg})
			}
			// journalctl prints oldest first; the UI wants newest first.
			for i, j := 0, len(out)-1; i < j; i, j = i+1, j-1 {
				out[i], out[j] = out[j], out[i]
			}
			return out, nil
		}
	}
	// Fallback: plain syslog files.
	for _, path := range []string{"/var/log/syslog", "/var/log/messages"} {
		b, err := os.ReadFile(path)
		if err != nil {
			continue
		}
		lines := strings.Split(strings.TrimSpace(string(b)), "\n")
		var out []logEntry
		for i := len(lines) - 1; i >= 0 && len(out) < limit; i-- {
			l := lines[i]
			if search != "" && !strings.Contains(strings.ToLower(l), strings.ToLower(search)) {
				continue
			}
			lvl := "info"
			ll := strings.ToLower(l)
			if strings.Contains(ll, "error") || strings.Contains(ll, "fail") {
				lvl = "error"
			} else if strings.Contains(ll, "warn") {
				lvl = "warning"
			}
			if level == "error" && lvl != "error" || level == "warning" && lvl == "info" {
				continue
			}
			out = append(out, logEntry{Level: lvl, Source: path, Message: l})
		}
		return out, nil
	}
	return nil, fmt.Errorf("no journal or syslog available on this device")
}

func macLogs(ctx context.Context, process, level string, limit, since int, search string) ([]logEntry, error) {
	if since <= 0 {
		since = 30
	}
	preds := []string{}
	switch level {
	case "error":
		preds = append(preds, "(messageType == error OR messageType == fault)")
	case "warning":
		preds = append(preds, "(messageType == error OR messageType == fault OR messageType == default)")
	}
	if process != "" {
		preds = append(preds, `process == "`+strings.ReplaceAll(process, `"`, "")+`"`)
	}
	if search != "" {
		preds = append(preds, `eventMessage CONTAINS[c] "`+strings.ReplaceAll(search, `"`, "")+`"`)
	}
	args := []string{"show", "--style", "json", "--last", strconv.Itoa(since) + "m"}
	if len(preds) > 0 {
		args = append(args, "--predicate", strings.Join(preds, " AND "))
	}
	cmd := exec.CommandContext(ctx, "log", args...)
	platform.PrepareCommand(cmd, "")
	raw, err := cmd.Output()
	if err != nil {
		return nil, fmt.Errorf("log show: %w", err)
	}
	var rows []map[string]interface{}
	if err := json.Unmarshal(raw, &rows); err != nil {
		return nil, fmt.Errorf("could not parse log output")
	}
	var out []logEntry
	for i := len(rows) - 1; i >= 0 && len(out) < limit; i-- {
		r := rows[i]
		lvl := "info"
		switch strings.ToLower(str(r, "messageType")) {
		case "error", "fault":
			lvl = "error"
		case "default":
			lvl = "warning"
		}
		src := str(r, "process")
		if sub := str(r, "subsystem"); sub != "" {
			src += " (" + sub + ")"
		}
		msg := str(r, "eventMessage")
		if len(msg) > 2000 {
			msg = msg[:2000]
		}
		out = append(out, logEntry{TS: str(r, "timestamp"), Level: lvl, Source: src, ID: str(r, "processID"), Message: msg})
	}
	return out, nil
}
