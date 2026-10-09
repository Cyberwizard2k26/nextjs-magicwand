// MagicWand agent - command line entry point and service wrapper.
//
//	magicwand-agent run                       run in the foreground (or as the service entry point)
//	magicwand-agent install --server URL --token TOKEN   install + start as a system service
//	magicwand-agent uninstall [--purge]       remove the service (and identity/config with --purge)
//	magicwand-agent start|stop|restart|status
//	magicwand-agent stamp --in agent.exe --out installer.exe --server URL --token TOKEN   build a pre-configured installer
//	magicwand-agent version
package main

import (
	"context"
	"flag"
	"fmt"
	"os"
	"os/signal"
	"path/filepath"
	"strings"
	"syscall"
	"time"

	"github.com/kardianos/service"

	"github.com/cyberwizard2k26/nextjs-magicwand/agent/internal/config"
	"github.com/cyberwizard2k26/nextjs-magicwand/agent/internal/identity"
	"github.com/cyberwizard2k26/nextjs-magicwand/agent/internal/logging"
)

// Version is set at build time: -ldflags "-X main.Version=1.2.3"
var Version = "0.1.0-dev"

const serviceName = "magicwand-agent"

var restartCh = make(chan struct{}, 1)

func requestRestart() {
	select {
	case restartCh <- struct{}{}:
	default:
	}
}

func logPath(dataDir string) string { return filepath.Join(dataDir, "logs", "agent.log") }

type program struct {
	cfg    *config.Config
	cancel context.CancelFunc
	done   chan struct{}
}

func (p *program) Start(s service.Service) error {
	ctx, cancel := context.WithCancel(context.Background())
	p.cancel = cancel
	p.done = make(chan struct{})
	go func() {
		defer close(p.done)
		runAgent(ctx, p.cfg)
	}()
	return nil
}

func (p *program) Stop(s service.Service) error {
	p.cancel()
	select {
	case <-p.done:
	case <-time.After(10 * time.Second):
	}
	return nil
}

func runAgent(ctx context.Context, cfg *config.Config) {
	id, err := identity.LoadOrCreate(cfg.DataDir)
	if err != nil {
		logging.Errorf("identity: %v", err)
		return
	}
	logging.Infof("MagicWand agent %s starting (agent id %s, server %s)", Version, id.AgentID, cfg.ServerURL)
	for {
		runCtx, cancel := context.WithCancel(ctx)
		a := NewAgent(cfg, id)
		go func() {
			select {
			case <-restartCh:
				logging.Infof("restart requested")
				cancel()
			case <-runCtx.Done():
			}
		}()
		a.Run(runCtx)
		cancel()
		if ctx.Err() != nil {
			return
		}
		time.Sleep(time.Second)
	}
}

func serviceConfig(cfg *config.Config) *service.Config {
	args := []string{"run"}
	if cfg != nil && cfg.DataDir != "" && cfg.DataDir != config.DefaultDataDir() {
		args = append(args, "--data-dir", cfg.DataDir)
	}
	name := "MagicWand Agent"
	if cfg != nil && cfg.ProductName != "" && cfg.ProductName != "MagicWand" {
		name = cfg.ProductName + " Agent"
	}
	return &service.Config{
		Name:        serviceName,
		DisplayName: name,
		Description: "Remote monitoring and management agent. Provides inventory, monitoring, patching and remote support for this device.",
		Arguments:   args,
		Option: service.KeyValue{
			"Restart":          "always",
			"RestartSec":       5,
			"OnFailure":        "restart",
			"StartType":        "automatic",
			"DelayedAutoStart": false,
			"KeepAlive":        true,
			"RunAtLoad":        true,
			"LogOutput":        false,
			"UserService":      false,
		},
	}
}

func main() {
	if len(os.Args) < 2 {
		// Double-clicked / no args: if the binary carries an installer config, install; otherwise print help.
		if t, _ := config.ReadTrailer(); t != nil && t.ServerURL != "" {
			os.Exit(cmdInstall([]string{}))
		}
		usage()
		os.Exit(2)
	}
	sub := os.Args[1]
	args := os.Args[2:]
	switch sub {
	case "run", "service":
		os.Exit(cmdRun(args))
	case "install", "enroll":
		os.Exit(cmdInstall(args))
	case "uninstall":
		os.Exit(cmdUninstall(args))
	case "start", "stop", "restart", "status":
		os.Exit(cmdControl(sub))
	case "stamp":
		os.Exit(cmdStamp(args))
	case "inventory":
		os.Exit(cmdInventory())
	case "version", "-v", "--version":
		fmt.Println("magicwand-agent", Version)
	case "help", "-h", "--help":
		usage()
	default:
		fmt.Fprintf(os.Stderr, "unknown command %q\n\n", sub)
		usage()
		os.Exit(2)
	}
}

func usage() {
	fmt.Fprintln(os.Stderr, `MagicWand Agent `+Version+`

Usage:
  magicwand-agent install --server https://rmm.example.com --token ENROLL_TOKEN [--data-dir DIR] [--insecure]
  magicwand-agent uninstall [--purge]
  magicwand-agent start | stop | restart | status
  magicwand-agent run [--server URL] [--token TOKEN] [--data-dir DIR] [--log-level debug]
  magicwand-agent stamp --in BINARY --out INSTALLER --server URL --token TOKEN [--org NAME] [--console URL]
  magicwand-agent inventory          print the inventory this agent would report (JSON)
  magicwand-agent version`)
}

func commonFlags(fs *flag.FlagSet) (*config.Config, *string) {
	o := &config.Config{}
	fs.StringVar(&o.ServerURL, "server", "", "server URL, e.g. https://rmm.example.com")
	fs.StringVar(&o.EnrollToken, "token", "", "enrollment token")
	fs.StringVar(&o.LogLevel, "log-level", "", "debug|info|warn|error")
	fs.StringVar(&o.Proxy, "proxy", "", "proxy URL")
	fs.StringVar(&o.ServerCertFingerprint, "cert-fingerprint", "", "pin the server certificate (sha256 hex)")
	fs.BoolVar(&o.Insecure, "insecure", false, "skip TLS verification (development only)")
	var roles string
	fs.StringVar(&roles, "roles", "", "comma separated roles, e.g. probe")
	dataDir := fs.String("data-dir", config.DefaultDataDir(), "state directory")
	fs.Func("role", "add a role (repeatable)", func(v string) error { o.Roles = append(o.Roles, v); return nil })
	fs.Func("tag", "add a tag (repeatable)", func(v string) error { o.Tags = append(o.Tags, v); return nil })
	fs.Func("_roles", "", func(v string) error { return nil })
	_ = roles
	return o, dataDir
}

func loadConfig(fs *flag.FlagSet, args []string, requireServer bool) (*config.Config, error) {
	o, dataDir := commonFlags(fs)
	if err := fs.Parse(args); err != nil {
		return nil, err
	}
	if r := fs.Lookup("roles"); r != nil && r.Value.String() != "" {
		for _, x := range strings.Split(r.Value.String(), ",") {
			if x = strings.TrimSpace(x); x != "" {
				o.Roles = append(o.Roles, x)
			}
		}
	}
	cfg, err := config.Load(*dataDir, *o)
	if err != nil && requireServer {
		return cfg, err
	}
	return cfg, nil
}

func setupLogging(cfg *config.Config) {
	if cfg.LogLevel != "" {
		logging.SetLevel(cfg.LogLevel)
	}
	if err := logging.SetFile(logPath(cfg.DataDir)); err != nil {
		logging.Warnf("file logging disabled: %v", err)
	}
}

func cmdRun(args []string) int {
	fs := flag.NewFlagSet("run", flag.ContinueOnError)
	cfg, err := loadConfig(fs, args, true)
	if err != nil {
		fmt.Fprintln(os.Stderr, "error:", err)
		return 1
	}
	setupLogging(cfg)
	prg := &program{cfg: cfg}
	svc, err := service.New(prg, serviceConfig(cfg))
	if err != nil {
		fmt.Fprintln(os.Stderr, "error:", err)
		return 1
	}
	if service.Interactive() {
		ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
		defer cancel()
		runAgent(ctx, cfg)
		return 0
	}
	if err := svc.Run(); err != nil {
		logging.Errorf("service: %v", err)
		return 1
	}
	return 0
}

func cmdInstall(args []string) int {
	fs := flag.NewFlagSet("install", flag.ContinueOnError)
	cfg, err := loadConfig(fs, args, true)
	if err != nil {
		fmt.Fprintln(os.Stderr, "error:", err)
		return 1
	}
	if !isElevated() {
		if relaunchElevated() {
			return 0
		}
		fmt.Fprintln(os.Stderr, "error: installation requires administrator/root privileges")
		return 1
	}
	if err := os.MkdirAll(cfg.DataDir, 0o755); err != nil {
		fmt.Fprintln(os.Stderr, "error:", err)
		return 1
	}
	// Copy the executable to a stable install location so the installer download can be deleted.
	exe, _ := os.Executable()
	target := installPath()
	if !samePath(exe, target) {
		if err := copyFile(exe, target); err != nil {
			fmt.Fprintln(os.Stderr, "error copying binary:", err)
			return 1
		}
	}
	if err := cfg.Save(); err != nil {
		fmt.Fprintln(os.Stderr, "error saving config:", err)
		return 1
	}
	setupLogging(cfg)
	sc := serviceConfig(cfg)
	sc.Executable = target
	svc, err := service.New(&program{cfg: cfg}, sc)
	if err != nil {
		fmt.Fprintln(os.Stderr, "error:", err)
		return 1
	}
	_ = service.Control(svc, "stop")
	_ = service.Control(svc, "uninstall")
	if err := service.Control(svc, "install"); err != nil {
		fmt.Fprintln(os.Stderr, "error installing service:", err)
		return 1
	}
	if err := service.Control(svc, "start"); err != nil {
		fmt.Fprintln(os.Stderr, "error starting service:", err)
		return 1
	}
	msg := fmt.Sprintf("%s agent installed and started.\nServer: %s", cfg.ProductName, cfg.ServerURL)
	if cfg.ConsoleURL != "" {
		msg += "\nOpen the console: " + cfg.ConsoleURL
	}
	fmt.Println(msg)
	notifyInstalled(cfg, msg)
	return 0
}

func cmdUninstall(args []string) int {
	fs := flag.NewFlagSet("uninstall", flag.ContinueOnError)
	purge := fs.Bool("purge", false, "also remove identity, config and logs")
	cfg, _ := loadConfig(fs, args, false)
	if !isElevated() {
		fmt.Fprintln(os.Stderr, "error: uninstall requires administrator/root privileges")
		return 1
	}
	svc, err := service.New(&program{cfg: cfg}, serviceConfig(cfg))
	if err != nil {
		fmt.Fprintln(os.Stderr, "error:", err)
		return 1
	}
	_ = service.Control(svc, "stop")
	if err := service.Control(svc, "uninstall"); err != nil {
		fmt.Fprintln(os.Stderr, "warning:", err)
	}
	if *purge && cfg != nil {
		_ = os.RemoveAll(cfg.DataDir)
	}
	_ = os.Remove(installPath())
	fmt.Println("agent removed")
	return 0
}

func cmdControl(action string) int {
	fs := flag.NewFlagSet(action, flag.ContinueOnError)
	cfg, _ := loadConfig(fs, nil, false)
	svc, err := service.New(&program{cfg: cfg}, serviceConfig(cfg))
	if err != nil {
		fmt.Fprintln(os.Stderr, "error:", err)
		return 1
	}
	if action == "status" {
		st, err := svc.Status()
		if err != nil {
			fmt.Println("status: unknown (", err, ")")
			return 1
		}
		fmt.Println("status:", map[service.Status]string{service.StatusRunning: "running", service.StatusStopped: "stopped", service.StatusUnknown: "unknown"}[st])
		return 0
	}
	if err := service.Control(svc, action); err != nil {
		fmt.Fprintln(os.Stderr, "error:", err)
		return 1
	}
	fmt.Println(action, "ok")
	return 0
}

func cmdStamp(args []string) int {
	fs := flag.NewFlagSet("stamp", flag.ContinueOnError)
	in := fs.String("in", "", "input binary")
	out := fs.String("out", "", "output installer")
	cfg := config.Config{}
	fs.StringVar(&cfg.ServerURL, "server", "", "server URL")
	fs.StringVar(&cfg.EnrollToken, "token", "", "enrollment token")
	fs.StringVar(&cfg.OrgName, "org", "", "organization name")
	fs.StringVar(&cfg.SiteName, "site", "", "site name")
	fs.StringVar(&cfg.ProductName, "product", "", "product name (branding)")
	fs.StringVar(&cfg.ConsoleURL, "console", "", "console deep link")
	fs.StringVar(&cfg.ServerCertFingerprint, "cert-fingerprint", "", "pin server certificate")
	fs.BoolVar(&cfg.Insecure, "insecure", false, "skip TLS verification")
	if err := fs.Parse(args); err != nil || *in == "" || *out == "" || cfg.ServerURL == "" {
		fmt.Fprintln(os.Stderr, "usage: stamp --in BINARY --out INSTALLER --server URL --token TOKEN")
		return 2
	}
	if err := config.AppendTrailer(*in, *out, &cfg); err != nil {
		fmt.Fprintln(os.Stderr, "error:", err)
		return 1
	}
	fmt.Println("wrote", *out)
	return 0
}

func cmdInventory() int {
	inv := NewAgent(&config.Config{ServerURL: "http://localhost", DataDir: os.TempDir()}, &identity.Identity{}).collectInventory(nil)
	b, _ := jsonIndent(inv)
	fmt.Println(string(b))
	return 0
}

func copyFile(src, dst string) error {
	b, err := os.ReadFile(src)
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(dst), 0o755); err != nil {
		return err
	}
	tmp := dst + ".new"
	if err := os.WriteFile(tmp, b, 0o755); err != nil {
		return err
	}
	return os.Rename(tmp, dst)
}

func samePath(a, b string) bool {
	ra, err1 := filepath.EvalSymlinks(a)
	rb, err2 := filepath.EvalSymlinks(b)
	if err1 != nil || err2 != nil {
		return strings.EqualFold(a, b)
	}
	return strings.EqualFold(ra, rb)
}
