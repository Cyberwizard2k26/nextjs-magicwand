package commands

import (
	"context"
	"encoding/base64"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"time"
)

// Screenshot captures the interactive user's screen (JPEG/PNG, base64). It runs in the user's session so
// it works from a service: PowerShell + GDI on Windows, screencapture on macOS, grim/import/scrot on Linux.
func Screenshot(ctx context.Context, c *Command) (interface{}, error) {
	user := consoleUser()
	if user == "" {
		return nil, errors.New("no user is signed in at the console, so there is no screen to capture")
	}
	switch runtime.GOOS {
	case "windows":
		script := `Add-Type -AssemblyName System.Windows.Forms,System.Drawing
$b=[System.Windows.Forms.Screen]::AllScreens | ForEach-Object { $_.Bounds }
$x=($b | ForEach-Object { $_.Left } | Measure-Object -Minimum).Minimum; $y=($b | ForEach-Object { $_.Top } | Measure-Object -Minimum).Minimum
$w=(($b | ForEach-Object { $_.Right } | Measure-Object -Maximum).Maximum)-$x; $h=(($b | ForEach-Object { $_.Bottom } | Measure-Object -Maximum).Maximum)-$y
$bmp=New-Object System.Drawing.Bitmap $w,$h; $g=[System.Drawing.Graphics]::FromImage($bmp); $g.CopyFromScreen($x,$y,0,0,$bmp.Size)
$enc=[System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object { $_.MimeType -eq 'image/jpeg' }
$p=New-Object System.Drawing.Imaging.EncoderParameters 1; $p.Param[0]=New-Object System.Drawing.Imaging.EncoderParameter([System.Drawing.Imaging.Encoder]::Quality,[long]70)
$ms=New-Object IO.MemoryStream; $bmp.Save($ms,$enc,$p); Write-Output ("$w,$h," + [Convert]::ToBase64String($ms.ToArray()))`
		out, err := ps(ctx, script, "user")
		if err != nil {
			return nil, err
		}
		parts := strings.SplitN(strings.TrimSpace(out), ",", 3)
		if len(parts) != 3 {
			return nil, errors.New("unexpected screenshot output")
		}
		w, _ := strconv.Atoi(parts[0])
		h, _ := strconv.Atoi(parts[1])
		return map[string]interface{}{"mime": "image/jpeg", "width": w, "height": h, "contentBase64": parts[2], "user": user, "capturedAt": time.Now().UTC().Format(time.RFC3339)}, nil
	case "darwin":
		tmp := filepath.Join(os.TempDir(), fmt.Sprintf("mw-shot-%d.jpg", time.Now().UnixNano()))
		defer os.Remove(tmp)
		if _, err := runOutAs(ctx, "user", "screencapture", "-x", "-t", "jpg", "-C", tmp); err != nil {
			return nil, err
		}
		return readImage(tmp, "image/jpeg", user)
	default:
		tmp := filepath.Join(os.TempDir(), fmt.Sprintf("mw-shot-%d.png", time.Now().UnixNano()))
		defer os.Remove(tmp)
		var lastErr error
		attempts := [][]string{{"grim", tmp}, {"gnome-screenshot", "-f", tmp}, {"spectacle", "-b", "-n", "-o", tmp}, {"import", "-window", "root", tmp}, {"scrot", "-o", tmp}, {"xfce4-screenshooter", "-f", "-s", tmp}}
		for _, a := range attempts {
			if !has(a[0]) {
				continue
			}
			if _, err := runOutAs(ctx, "user", a[0], a[1:]...); err != nil {
				lastErr = err
				continue
			}
			if st, err := os.Stat(tmp); err == nil && st.Size() > 0 {
				return readImage(tmp, "image/png", user)
			}
		}
		if lastErr == nil {
			lastErr = errors.New("no screenshot tool found (install grim, gnome-screenshot, scrot or ImageMagick)")
		}
		return nil, lastErr
	}
}

func readImage(path, mime, user string) (interface{}, error) {
	b, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	return map[string]interface{}{"mime": mime, "contentBase64": base64.StdEncoding.EncodeToString(b), "user": user, "capturedAt": time.Now().UTC().Format(time.RFC3339)}, nil
}

// MessageUser shows a dialog on the interactive desktop and reports which button was pressed.
//   { title, body, timeoutSeconds?, buttons?: ok|okcancel|yesno }
func MessageUser(ctx context.Context, c *Command) (interface{}, error) {
	var a struct {
		Title          string `json:"title"`
		Body           string `json:"body"`
		TimeoutSeconds int    `json:"timeoutSeconds"`
		Buttons        string `json:"buttons"`
	}
	if err := c.Arg(&a); err != nil {
		return nil, err
	}
	if a.Title == "" {
		a.Title = "Message from IT"
	}
	if strings.TrimSpace(a.Body) == "" {
		return nil, errors.New("body is required")
	}
	if a.TimeoutSeconds <= 0 {
		a.TimeoutSeconds = 0
	}
	user := consoleUser()
	switch runtime.GOOS {
	case "windows":
		if user == "" {
			return nil, errors.New("no user is signed in")
		}
		btn := map[string]int{"ok": 0, "okcancel": 1, "yesno": 4}[strings.ToLower(a.Buttons)]
		script := `$sh=New-Object -ComObject WScript.Shell; $r=$sh.Popup(` + psq(a.Body) + `, ` + strconv.Itoa(a.TimeoutSeconds) + `, ` + psq(a.Title) + `, ` + strconv.Itoa(64+btn) + `); Write-Output $r`
		out, err := ps(ctx, script, "user")
		if err != nil {
			// Session-0 fallback: msg.exe broadcasts to every session (Pro/Enterprise editions).
			if _, merr := runOut(ctx, "msg.exe", "*", "/time:"+strconv.Itoa(max(a.TimeoutSeconds, 60)), a.Title+": "+a.Body); merr == nil {
				return map[string]interface{}{"delivered": true, "button": "unknown", "via": "msg.exe"}, nil
			}
			return nil, err
		}
		code := strings.TrimSpace(out)
		button := map[string]string{"1": "ok", "2": "cancel", "6": "yes", "7": "no", "-1": "timeout"}[code]
		if button == "" {
			button = code
		}
		return map[string]interface{}{"delivered": true, "button": button, "user": user}, nil
	case "darwin":
		if user == "" {
			return nil, errors.New("no user is signed in")
		}
		buttons := `{"OK"}`
		switch strings.ToLower(a.Buttons) {
		case "okcancel":
			buttons = `{"Cancel","OK"}`
		case "yesno":
			buttons = `{"No","Yes"}`
		}
		script := `display dialog "` + asEsc(a.Body) + `" with title "` + asEsc(a.Title) + `" buttons ` + buttons + ` default button 1`
		if a.TimeoutSeconds > 0 {
			script += " giving up after " + strconv.Itoa(a.TimeoutSeconds)
		}
		out, err := runOutAs(ctx, "user", "osascript", "-e", script)
		if err != nil {
			if strings.Contains(err.Error(), "-128") {
				return map[string]interface{}{"delivered": true, "button": "cancel", "user": user}, nil
			}
			return nil, err
		}
		button := "ok"
		if i := strings.Index(out, "button returned:"); i >= 0 {
			button = strings.ToLower(strings.TrimSpace(strings.SplitN(out[i+len("button returned:"):], ",", 2)[0]))
		}
		if strings.Contains(out, "gave up:true") {
			button = "timeout"
		}
		return map[string]interface{}{"delivered": true, "button": button, "user": user}, nil
	default:
		if user == "" {
			return nil, errors.New("no user is signed in")
		}
		if has("zenity") {
			args := []string{"--info", "--title=" + a.Title, "--text=" + a.Body, "--width=420"}
			if strings.EqualFold(a.Buttons, "yesno") || strings.EqualFold(a.Buttons, "okcancel") {
				args[0] = "--question"
			}
			if a.TimeoutSeconds > 0 {
				args = append(args, "--timeout="+strconv.Itoa(a.TimeoutSeconds))
			}
			_, err := runOutAs(ctx, "user", "zenity", args...)
			button := "ok"
			if err != nil {
				if strings.Contains(err.Error(), "exit status 5") {
					button = "timeout"
				} else if strings.Contains(err.Error(), "exit status 1") {
					button = "cancel"
				} else {
					return nil, err
				}
			}
			return map[string]interface{}{"delivered": true, "button": button, "user": user}, nil
		}
		if has("notify-send") {
			if _, err := runOutAs(ctx, "user", "notify-send", "-u", "critical", a.Title, a.Body); err != nil {
				return nil, err
			}
			return map[string]interface{}{"delivered": true, "button": "unknown", "via": "notify-send", "user": user}, nil
		}
		return nil, errors.New("no dialog tool found on this device (install zenity or libnotify)")
	}
}

// NotifyUser shows a non-blocking toast / notification.
func NotifyUser(ctx context.Context, c *Command) (interface{}, error) {
	var a struct {
		Title string `json:"title"`
		Body  string `json:"body"`
	}
	if err := c.Arg(&a); err != nil {
		return nil, err
	}
	if a.Title == "" {
		a.Title = "IT notice"
	}
	user := consoleUser()
	if user == "" {
		return nil, errors.New("no user is signed in")
	}
	switch runtime.GOOS {
	case "windows":
		script := `Add-Type -AssemblyName System.Windows.Forms,System.Drawing
$n=New-Object System.Windows.Forms.NotifyIcon; $n.Icon=[System.Drawing.SystemIcons]::Information; $n.Visible=$true
$n.ShowBalloonTip(10000, ` + psq(a.Title) + `, ` + psq(a.Body) + `, [System.Windows.Forms.ToolTipIcon]::Info); Start-Sleep -Seconds 8; $n.Dispose(); 'shown'`
		if _, err := ps(ctx, script, "user"); err != nil {
			return nil, err
		}
	case "darwin":
		if _, err := runOutAs(ctx, "user", "osascript", "-e", `display notification "`+asEsc(a.Body)+`" with title "`+asEsc(a.Title)+`"`); err != nil {
			return nil, err
		}
	default:
		if !has("notify-send") {
			return nil, errors.New("notify-send is not installed")
		}
		if _, err := runOutAs(ctx, "user", "notify-send", a.Title, a.Body); err != nil {
			return nil, err
		}
	}
	return map[string]interface{}{"delivered": true, "user": user}, nil
}

func asEsc(s string) string {
	return strings.NewReplacer(`\`, `\\`, `"`, `\"`, "\n", `\n`).Replace(s)
}
