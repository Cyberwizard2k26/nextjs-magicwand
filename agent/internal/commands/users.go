package commands

import (
	"context"
	"errors"
	"fmt"
	"regexp"
	"runtime"
	"strings"
)

var usernameRe = regexp.MustCompile(`^[A-Za-z0-9._\-\\$@ ]{1,104}$`)

// LocalUserAction manages local accounts. Passwords travel in the command payload (TLS) and are handed to
// the OS over stdin, never on a command line.
//   { username, action: unlock|enable|disable|reset_password|create|delete|add_admin|remove_admin|expire_password,
//     password?, fullName?, admin? }
func LocalUserAction(ctx context.Context, c *Command) (interface{}, error) {
	var a struct {
		Username string `json:"username"`
		Action   string `json:"action"`
		Password string `json:"password"`
		FullName string `json:"fullName"`
		Admin    bool   `json:"admin"`
	}
	if err := c.Arg(&a); err != nil {
		return nil, err
	}
	a.Username = strings.TrimSpace(a.Username)
	if !usernameRe.MatchString(a.Username) {
		return nil, errors.New("invalid username")
	}
	needsPw := a.Action == "reset_password" || a.Action == "create"
	if needsPw && len(a.Password) < 8 {
		return nil, errors.New("password must be at least 8 characters")
	}
	var steps []string
	var err error
	switch runtime.GOOS {
	case "windows":
		steps, err = windowsUser(ctx, a.Username, a.Action, a.Password, a.FullName, a.Admin)
	case "darwin":
		steps, err = macUser(ctx, a.Username, a.Action, a.Password, a.FullName, a.Admin)
	default:
		steps, err = linuxUser(ctx, a.Username, a.Action, a.Password, a.FullName, a.Admin)
	}
	if err != nil {
		return map[string]interface{}{"steps": steps}, err
	}
	return map[string]interface{}{"username": a.Username, "action": a.Action, "steps": steps}, nil
}

func windowsUser(ctx context.Context, u, action, pw, fullName string, admin bool) ([]string, error) {
	n := psq(u)
	var script string
	switch action {
	case "unlock":
		script = `$acct=[ADSI]("WinNT://./" + ` + n + ` + ",user"); if($acct.IsAccountLocked){ $acct.IsAccountLocked=$false; $acct.SetInfo(); 'lockout cleared' } else { 'not locked out' }
Enable-LocalUser -Name ` + n + `; 'account enabled'`
	case "enable":
		script = `Enable-LocalUser -Name ` + n + `; 'account enabled'`
	case "disable":
		script = `Disable-LocalUser -Name ` + n + `; 'account disabled'`
	case "reset_password":
		script = `$p=ConvertTo-SecureString -String ` + psq(pw) + ` -AsPlainText -Force
Set-LocalUser -Name ` + n + ` -Password $p -PasswordNeverExpires $false; 'password reset'
$acct=[ADSI]("WinNT://./" + ` + n + ` + ",user"); if($acct.IsAccountLocked){ $acct.IsAccountLocked=$false; $acct.SetInfo(); 'lockout cleared' }`
	case "expire_password":
		script = `$acct=[ADSI]("WinNT://./" + ` + n + ` + ",user"); $acct.PasswordExpired=1; $acct.SetInfo(); 'user must change password at next sign-in'`
	case "create":
		fn := fullName
		if fn == "" {
			fn = u
		}
		script = `$p=ConvertTo-SecureString -String ` + psq(pw) + ` -AsPlainText -Force
New-LocalUser -Name ` + n + ` -Password $p -FullName ` + psq(fn) + ` -Description 'Created by MagicWand' | Out-Null; 'account created'
Add-LocalGroupMember -Group 'Users' -Member ` + n + ` -ErrorAction SilentlyContinue`
		if admin {
			script += "\nAdd-LocalGroupMember -Group 'Administrators' -Member " + n + "; 'added to Administrators'"
		}
	case "delete":
		script = `Remove-LocalUser -Name ` + n + `; 'account removed'`
	case "add_admin":
		script = `Add-LocalGroupMember -Group 'Administrators' -Member ` + n + `; 'added to Administrators'`
	case "remove_admin":
		script = `Remove-LocalGroupMember -Group 'Administrators' -Member ` + n + `; 'removed from Administrators'`
	default:
		return nil, fmt.Errorf("unknown action %q", action)
	}
	out, err := ps(ctx, script, "")
	return nonEmptyLines(out), err
}

func linuxUser(ctx context.Context, u, action, pw, fullName string, admin bool) ([]string, error) {
	var steps []string
	try := func(label string, name string, args ...string) bool {
		if !has(name) {
			return false
		}
		if _, err := runOut(ctx, name, args...); err == nil {
			steps = append(steps, label)
			return true
		}
		return false
	}
	must := func(label string, name string, args ...string) error {
		if _, err := runOut(ctx, name, args...); err != nil {
			return err
		}
		steps = append(steps, label)
		return nil
	}
	adminGroup := "sudo"
	if out, err := runOut(ctx, "getent", "group", "wheel"); err == nil && out != "" {
		adminGroup = "wheel"
	}
	switch action {
	case "unlock":
		try("faillock counter reset", "faillock", "--user", u, "--reset")
		try("pam_tally2 counter reset", "pam_tally2", "--user", u, "--reset")
		try("password unlocked", "usermod", "-U", u)
		try("account expiry removed", "chage", "-E", "-1", u)
		if len(steps) == 0 {
			return steps, errors.New("no unlock tool succeeded (faillock, pam_tally2, usermod)")
		}
	case "enable":
		if err := must("password unlocked", "usermod", "-U", u); err != nil {
			return steps, err
		}
		try("account expiry removed", "chage", "-E", "-1", u)
		try("login shell restored", "usermod", "-s", "/bin/bash", u)
	case "disable":
		if err := must("password locked", "usermod", "-L", u); err != nil {
			return steps, err
		}
		try("account expired", "chage", "-E", "1", u)
	case "reset_password":
		if _, err := runStdin(ctx, u+":"+pw+"\n", "", "chpasswd"); err != nil {
			return steps, err
		}
		steps = append(steps, "password reset")
		try("password unlocked", "usermod", "-U", u)
		try("faillock counter reset", "faillock", "--user", u, "--reset")
	case "expire_password":
		if err := must("user must change password at next login", "chage", "-d", "0", u); err != nil {
			return steps, err
		}
	case "create":
		args := []string{"-m", "-s", "/bin/bash"}
		if fullName != "" {
			args = append(args, "-c", fullName)
		}
		if err := must("account created", "useradd", append(args, u)...); err != nil {
			return steps, err
		}
		if _, err := runStdin(ctx, u+":"+pw+"\n", "", "chpasswd"); err != nil {
			return steps, err
		}
		steps = append(steps, "password set")
		if admin {
			if err := must("added to "+adminGroup, "usermod", "-aG", adminGroup, u); err != nil {
				return steps, err
			}
		}
	case "delete":
		if err := must("account and home removed", "userdel", "-r", u); err != nil {
			return steps, err
		}
	case "add_admin":
		if err := must("added to "+adminGroup, "usermod", "-aG", adminGroup, u); err != nil {
			return steps, err
		}
	case "remove_admin":
		if err := must("removed from "+adminGroup, "gpasswd", "-d", u, adminGroup); err != nil {
			return steps, err
		}
	default:
		return nil, fmt.Errorf("unknown action %q", action)
	}
	return steps, nil
}

func macUser(ctx context.Context, u, action, pw, fullName string, admin bool) ([]string, error) {
	var steps []string
	must := func(label string, name string, args ...string) error {
		if _, err := runOut(ctx, name, args...); err != nil {
			return err
		}
		steps = append(steps, label)
		return nil
	}
	setPw := func() error {
		// dscl in interactive mode reads commands from stdin, so the password never appears in argv.
		if _, err := runStdin(ctx, "passwd /Users/"+u+" "+pw+"\nquit\n", "", "dscl", "."); err != nil {
			return err
		}
		steps = append(steps, "password set")
		return nil
	}
	switch action {
	case "unlock", "enable":
		if err := must("account enabled and lockout cleared", "pwpolicy", "-u", u, "-enableuser"); err != nil {
			return steps, err
		}
	case "disable":
		if err := must("account disabled", "pwpolicy", "-u", u, "-disableuser"); err != nil {
			return steps, err
		}
	case "reset_password":
		if err := setPw(); err != nil {
			return steps, err
		}
		_ = must("lockout cleared", "pwpolicy", "-u", u, "-enableuser")
	case "expire_password":
		if err := must("user must change password at next login", "pwpolicy", "-u", u, "-setpolicy", "newPasswordRequired=1"); err != nil {
			return steps, err
		}
	case "create":
		fn := fullName
		if fn == "" {
			fn = u
		}
		args := []string{"-addUser", u, "-fullName", fn}
		if admin {
			args = append(args, "-admin")
		}
		// sysadminctl requires a password argument; set a throwaway one, then replace it via stdin.
		if err := must("account created", "sysadminctl", append(args, "-password", "-")...); err != nil {
			return steps, err
		}
		if err := setPw(); err != nil {
			return steps, err
		}
	case "delete":
		if err := must("account removed", "sysadminctl", "-deleteUser", u); err != nil {
			return steps, err
		}
	case "add_admin":
		if err := must("added to admin group", "dseditgroup", "-o", "edit", "-a", u, "-t", "user", "admin"); err != nil {
			return steps, err
		}
	case "remove_admin":
		if err := must("removed from admin group", "dseditgroup", "-o", "edit", "-d", u, "-t", "user", "admin"); err != nil {
			return steps, err
		}
	default:
		return nil, fmt.Errorf("unknown action %q", action)
	}
	return steps, nil
}

// UnlockSession unlocks the interactive desktop session where the OS allows it.
func UnlockSession(ctx context.Context, c *Command) (interface{}, error) {
	switch runtime.GOOS {
	case "linux":
		if !has("loginctl") {
			return nil, unsupported("session unlock without systemd-logind")
		}
		out, err := runOut(ctx, "loginctl", "unlock-sessions")
		if err != nil {
			return nil, err
		}
		return map[string]interface{}{"unlocked": true, "output": out}, nil
	case "windows":
		return nil, errors.New("Windows does not allow unlocking a locked desktop remotely without a credential provider; unlock the user's account instead, or sign the user out and back in")
	default:
		return nil, errors.New("macOS does not allow unlocking the login window remotely; unlock the user's account instead")
	}
}

func nonEmptyLines(s string) []string {
	var out []string
	for _, l := range strings.Split(s, "\n") {
		if t := strings.TrimSpace(l); t != "" {
			out = append(out, t)
		}
	}
	return out
}
