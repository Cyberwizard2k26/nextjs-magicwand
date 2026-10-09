package main

import (
	"context"
	"encoding/json"
	"os"
	"runtime"
	"sync"
	"time"

	"github.com/cyberwizard2k26/nextjs-magicwand/agent/internal/collectors"
	"github.com/cyberwizard2k26/nextjs-magicwand/agent/internal/commands"
	"github.com/cyberwizard2k26/nextjs-magicwand/agent/internal/config"
	"github.com/cyberwizard2k26/nextjs-magicwand/agent/internal/identity"
	"github.com/cyberwizard2k26/nextjs-magicwand/agent/internal/logging"
	"github.com/cyberwizard2k26/nextjs-magicwand/agent/internal/protocol"
	"github.com/cyberwizard2k26/nextjs-magicwand/agent/internal/sessions"
	"github.com/cyberwizard2k26/nextjs-magicwand/agent/internal/transport"
)

// Agent ties transport, collectors and the command dispatcher together.
type Agent struct {
	cfg  *config.Config
	id   *identity.Identity
	cli  *transport.Client
	disp *commands.Dispatcher
	sess *sessions.Manager

	mu            sync.Mutex
	serverConfig  map[string]interface{}
	telemetryIntv time.Duration
	inventoryIntv time.Duration
	wakeTelemetry chan struct{}
	wakeInventory chan struct{}
}

func NewAgent(cfg *config.Config, id *identity.Identity) *Agent {
	a := &Agent{cfg: cfg, id: id, telemetryIntv: 60 * time.Second, inventoryIntv: 60 * time.Minute, wakeTelemetry: make(chan struct{}, 1), wakeInventory: make(chan struct{}, 1)}
	a.cli = transport.New(cfg, id, Version, a.hello, transport.Handlers{
		OnWelcome: a.onWelcome,
		OnCommand: func(c *protocol.Command) { a.disp.Handle(c) },
		OnConfig:  a.applyConfig,
		OnChat:    func(c *protocol.ServerChat) { logging.Infof("chat from %s: %s", c.From, c.Body) },
		OnBinary:  func(streamID uint32, payload []byte) { a.sess.HandleFrame(streamID, payload) },
		OnError:   func(e *protocol.ServerError) { logging.Errorf("server error %s: %s", e.Code, e.Message) },
		OnClose:   func(err error) { a.sess.CloseAll("connection lost") },
	})
	a.sess = sessions.NewManager(a.cli)
	a.disp = commands.NewDispatcher(a.cli)
	a.registerCommands()
	return a
}

func (a *Agent) hello() *protocol.Hello {
	sys := collectors.System()
	h := &protocol.Hello{
		Hostname:     sys.Hostname,
		Platform:     collectors.Platform(),
		Arch:         runtime.GOARCH,
		OSName:       sys.OSName,
		OSVersion:    sys.OSVersion,
		OSBuild:      sys.OSBuild,
		Kernel:       sys.Kernel,
		Capabilities: append(append([]string{}, protocol.Capabilities...), platformCapabilities()...),
		Roles:        a.cfg.Roles,
		TZ:           sys.Timezone,
	}
	if h.Roles == nil {
		h.Roles = []string{}
	}
	return h
}

func (a *Agent) onWelcome(w *protocol.Welcome) {
	if a.cfg.EnrollToken != "" {
		// Enrollment succeeded: forget the token so a re-install cannot reuse it.
		a.cfg.EnrollToken = ""
		if err := a.cfg.Save(); err != nil {
			logging.Warnf("could not persist config: %v", err)
		}
	}
	a.applyConfig(w.Config)
	if w.PendingApproval {
		logging.Infof("device is waiting for approval in the console")
	}
	select {
	case a.wakeInventory <- struct{}{}:
	default:
	}
	select {
	case a.wakeTelemetry <- struct{}{}:
	default:
	}
}

func (a *Agent) applyConfig(cfg map[string]interface{}) {
	a.mu.Lock()
	defer a.mu.Unlock()
	a.serverConfig = cfg
	if v, ok := num(cfg["telemetryIntervalSeconds"]); ok && v >= 10 {
		a.telemetryIntv = time.Duration(v) * time.Second
	}
	if v, ok := num(cfg["inventoryIntervalMinutes"]); ok && v >= 5 {
		a.inventoryIntv = time.Duration(v) * time.Minute
	}
	if lvl, ok := cfg["logLevel"].(string); ok {
		logging.SetLevel(lvl)
	}
}

func num(v interface{}) (float64, bool) {
	switch n := v.(type) {
	case float64:
		return n, true
	case int:
		return float64(n), true
	case json.Number:
		f, err := n.Float64()
		return f, err == nil
	}
	return 0, false
}

func (a *Agent) registerCommands() {
	d := a.disp
	d.Register("run_command", commands.RunCommand)
	d.Register("run_script", commands.RunScript)
	d.Register("process_list", commands.ProcessList)
	d.Register("process_kill", commands.ProcessKill)
	d.Register("process_start", commands.ProcessStart)
	d.Register("file_list", commands.FileList)
	d.Register("file_read", commands.FileRead)
	d.Register("file_write", commands.FileWrite)
	d.Register("file_delete", commands.FileDelete)
	d.Register("file_mkdir", commands.FileMkdir)
	d.Register("file_rename", commands.FileRename)
	d.Register("file_hash", commands.FileHash)
	d.Register("file_search", commands.FileSearch)
	d.Register("reboot", commands.Reboot)
	d.Register("shutdown", commands.Shutdown)
	d.Register("lock", commands.Lock)
	d.Register("logoff", commands.Logoff)
	d.Register("sleep", commands.Sleep)
	d.Register("wake_on_lan", commands.WakeOnLAN)
	d.Register("ping", commands.Ping)
	d.Register("port_check", commands.PortCheck)
	d.Register("dns_lookup", commands.DNSLookup)
	d.Register("traceroute", commands.Traceroute)
	d.Register("service_action", commands.ServiceAction)
	d.Register("local_user_action", commands.LocalUserAction)
	d.Register("unlock_session", commands.UnlockSession)
	d.Register("eventlog_query", commands.EventLogQuery)
	d.Register("task_scheduler_list", commands.TaskSchedulerList)
	d.Register("task_scheduler_action", commands.TaskSchedulerAction)
	d.Register("patch_scan", commands.PatchScan)
	d.Register("patch_install", commands.PatchInstall)
	d.Register("software_install", commands.SoftwareInstall)
	d.Register("software_uninstall", commands.SoftwareUninstall)
	d.Register("screenshot", commands.Screenshot)
	d.Register("message_user", commands.MessageUser)
	d.Register("notify_user", commands.NotifyUser)
	d.Register("registry_list", commands.RegistryList)
	d.Register("registry_get", commands.RegistryGet)
	d.Register("registry_set", commands.RegistrySet)
	d.Register("registry_delete", commands.RegistryDelete)
	d.Register("inventory", func(ctx context.Context, c *commands.Command) (interface{}, error) {
		var args struct {
			Full     bool     `json:"full"`
			Sections []string `json:"sections"`
		}
		_ = c.Arg(&args)
		inv := a.collectInventory(args.Sections)
		return nil, a.cli.SendJSON(inv)
	})
	d.Register("telemetry_now", func(ctx context.Context, c *commands.Command) (interface{}, error) {
		t := collectors.Telemetry()
		return t, a.cli.SendJSON(t)
	})
	d.Register("agent_logs", func(ctx context.Context, c *commands.Command) (interface{}, error) {
		b, err := os.ReadFile(logPath(a.cfg.DataDir))
		if err != nil {
			return nil, err
		}
		if len(b) > 256*1024 {
			b = b[len(b)-256*1024:]
		}
		return map[string]interface{}{"log": string(b)}, nil
	})
	d.Register("agent_restart", func(ctx context.Context, c *commands.Command) (interface{}, error) {
		go func() { time.Sleep(500 * time.Millisecond); requestRestart() }()
		return map[string]interface{}{"restarting": true}, nil
	})
	d.Register("session_open", func(ctx context.Context, c *commands.Command) (interface{}, error) {
		var req sessions.OpenRequest
		if err := c.Arg(&req); err != nil {
			return nil, err
		}
		req.RunAs = c.RunAs
		s, err := a.sess.Open(req)
		if err != nil {
			return nil, err
		}
		return map[string]interface{}{"sessionId": s.ID, "streamId": s.StreamID, "shell": s.Shell}, nil
	})
	d.Register("session_close", func(ctx context.Context, c *commands.Command) (interface{}, error) {
		var args struct {
			SessionID string `json:"sessionId"`
			Reason    string `json:"reason"`
		}
		_ = c.Arg(&args)
		if args.Reason == "" {
			args.Reason = "closed by server"
		}
		return map[string]interface{}{"closed": a.sess.Close(args.SessionID, args.Reason)}, nil
	})
	d.Register("config_update", func(ctx context.Context, c *commands.Command) (interface{}, error) {
		var cfg map[string]interface{}
		_ = c.Arg(&cfg)
		a.applyConfig(cfg)
		return map[string]interface{}{"applied": true}, nil
	})
	registerPlatformCommands(a, d)
}

func (a *Agent) collectInventory(sections []string) *protocol.Inventory {
	if len(sections) == 0 {
		return collectors.Full()
	}
	inv := &protocol.Inventory{T: "inventory", Full: false}
	for _, s := range sections {
		switch s {
		case "system":
			inv.System = collectors.System()
		case "hardware":
			inv.Hardware = collectors.Hardware()
		case "software":
			inv.Software = collectors.Software()
		case "services":
			inv.Services = collectors.Services()
		case "users":
			inv.LocalUsers = collectors.LocalUsers()
		case "security":
			inv.Security = collectors.Security()
		}
	}
	return inv
}

// Run starts the connection loop and periodic collectors; blocks until ctx ends.
func (a *Agent) Run(ctx context.Context) {
	var wg sync.WaitGroup
	wg.Add(3)
	go func() { defer wg.Done(); a.cli.Run(ctx) }()
	go func() { defer wg.Done(); a.heartbeatLoop(ctx) }()
	go func() { defer wg.Done(); a.collectorLoop(ctx) }()
	wg.Wait()
	a.sess.CloseAll("agent stopping")
	a.disp.CancelAll()
}

func (a *Agent) heartbeatLoop(ctx context.Context) {
	t := time.NewTicker(30 * time.Second)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			if !a.cli.IsReady() {
				continue
			}
			hb := protocol.Heartbeat{T: "heartbeat"}
			if u := collectors.ConsoleUser(); u != "" {
				hb.LoggedInUsers = []protocol.LoggedInUser{{User: u, Session: "console", Type: "console"}}
			}
			if pr, ok := pendingReboot(); ok {
				hb.PendingReboot = &pr
			}
			_ = a.cli.SendJSON(hb)
		}
	}
}

func (a *Agent) collectorLoop(ctx context.Context) {
	telemetryTimer := time.NewTimer(5 * time.Second)
	inventoryTimer := time.NewTimer(10 * time.Second)
	defer telemetryTimer.Stop()
	defer inventoryTimer.Stop()
	for {
		a.mu.Lock()
		ti, ii := a.telemetryIntv, a.inventoryIntv
		a.mu.Unlock()
		select {
		case <-ctx.Done():
			return
		case <-telemetryTimer.C:
			if a.cli.IsReady() {
				_ = a.cli.SendJSON(collectors.Telemetry())
			}
			telemetryTimer.Reset(ti)
		case <-a.wakeTelemetry:
			if a.cli.IsReady() {
				_ = a.cli.SendJSON(collectors.Telemetry())
			}
		case <-inventoryTimer.C:
			if a.cli.IsReady() {
				_ = a.cli.SendJSON(collectors.Full())
			}
			inventoryTimer.Reset(ii)
		case <-a.wakeInventory:
			if a.cli.IsReady() {
				_ = a.cli.SendJSON(collectors.Full())
				inventoryTimer.Reset(ii)
			}
		}
	}
}
