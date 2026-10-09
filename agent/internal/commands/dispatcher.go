// Package commands executes server commands. Each command runs in its own goroutine with a context that
// is cancelled on timeout or on an explicit `cancel` command, and reports a Result when done.
package commands

import (
	"context"
	"encoding/json"
	"fmt"
	"runtime/debug"
	"sync"
	"time"

	"github.com/cyberwizard2k26/nextjs-magicwand/agent/internal/logging"
	"github.com/cyberwizard2k26/nextjs-magicwand/agent/internal/protocol"
)

// Sender abstracts the transport so commands can stream output and results.
type Sender interface {
	SendJSON(v interface{}) error
	SendBinary(streamID uint32, payload []byte) error
}

// Handler executes one command. Use ctx for cancellation, emit for streaming output, and return data or an error.
type Handler func(ctx context.Context, c *Command) (data interface{}, err error)

// Command is the handler-facing view of a server command.
type Command struct {
	ID     string
	Name   string
	Args   json.RawMessage
	RunAs  string
	Stream bool
	sender Sender
	stdout []byte
	stderr []byte
	exit   *int
	mu     sync.Mutex
}

// Arg decodes the arguments into v.
func (c *Command) Arg(v interface{}) error {
	if len(c.Args) == 0 {
		return nil
	}
	return json.Unmarshal(c.Args, v)
}

// Emit streams a chunk of output (stdout or stderr) and keeps it for the final result.
func (c *Command) Emit(stream string, data []byte) {
	if len(data) == 0 {
		return
	}
	c.mu.Lock()
	if stream == "stderr" {
		if len(c.stderr) < 1<<20 {
			c.stderr = append(c.stderr, data...)
		}
	} else if len(c.stdout) < 1<<20 {
		c.stdout = append(c.stdout, data...)
	}
	c.mu.Unlock()
	if c.Stream && c.sender != nil {
		_ = c.sender.SendJSON(protocol.Output{T: "output", ID: c.ID, Stream: stream, Data: string(data)})
	}
}

// SetExitCode records the process exit code for the result.
func (c *Command) SetExitCode(code int) { c.exit = &code }

type running struct {
	cancel context.CancelFunc
}

// Dispatcher maps command names to handlers and tracks running commands.
type Dispatcher struct {
	mu       sync.Mutex
	handlers map[string]Handler
	running  map[string]*running
	sender   Sender
}

func NewDispatcher(sender Sender) *Dispatcher {
	d := &Dispatcher{handlers: map[string]Handler{}, running: map[string]*running{}, sender: sender}
	d.Register("cancel", d.cancelHandler)
	return d
}

func (d *Dispatcher) Register(name string, h Handler) { d.handlers[name] = h }

func (d *Dispatcher) cancelHandler(_ context.Context, c *Command) (interface{}, error) {
	var a struct {
		ID string `json:"id"`
	}
	_ = c.Arg(&a)
	d.mu.Lock()
	r := d.running[a.ID]
	d.mu.Unlock()
	if r == nil {
		return map[string]bool{"cancelled": false}, nil
	}
	r.cancel()
	return map[string]bool{"cancelled": true}, nil
}

// Handle executes a protocol command asynchronously.
func (d *Dispatcher) Handle(pc *protocol.Command) {
	h, ok := d.handlers[pc.Cmd]
	if !ok {
		_ = d.sender.SendJSON(protocol.Result{T: "result", ID: pc.ID, OK: false, Error: "unsupported command: " + pc.Cmd})
		return
	}
	timeout := time.Duration(pc.TimeoutSeconds) * time.Second
	if timeout <= 0 {
		timeout = 10 * time.Minute
	}
	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	d.mu.Lock()
	d.running[pc.ID] = &running{cancel: cancel}
	d.mu.Unlock()
	c := &Command{ID: pc.ID, Name: pc.Cmd, Args: pc.Args, RunAs: pc.RunAs, Stream: pc.Stream, sender: d.sender}
	go func() {
		started := time.Now()
		defer func() {
			cancel()
			d.mu.Lock()
			delete(d.running, pc.ID)
			d.mu.Unlock()
		}()
		res := protocol.Result{T: "result", ID: pc.ID, OK: true}
		func() {
			defer func() {
				if r := recover(); r != nil {
					logging.Errorf("command %s panicked: %v\n%s", pc.Cmd, r, debug.Stack())
					res.OK = false
					res.Error = fmt.Sprintf("panic: %v", r)
				}
			}()
			data, err := h(ctx, c)
			res.Data = data
			if err != nil {
				res.OK = false
				res.Error = err.Error()
				if ctx.Err() == context.DeadlineExceeded {
					res.Error = "timed out"
				} else if ctx.Err() == context.Canceled {
					res.Error = "cancelled"
				}
			}
		}()
		c.mu.Lock()
		res.Stdout = string(c.stdout)
		res.Stderr = string(c.stderr)
		c.mu.Unlock()
		res.ExitCode = c.exit
		res.DurationMs = time.Since(started).Milliseconds()
		if err := d.sender.SendJSON(res); err != nil {
			logging.Warnf("could not send result for %s: %v", pc.Cmd, err)
		}
	}()
}

// CancelAll cancels every running command (used on shutdown).
func (d *Dispatcher) CancelAll() {
	d.mu.Lock()
	defer d.mu.Unlock()
	for _, r := range d.running {
		r.cancel()
	}
}
