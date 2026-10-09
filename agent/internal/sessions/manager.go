// Package sessions implements interactive remote sessions carried over the binary stream channel.
// Today that is the terminal (a real PTY: bash/zsh/sh on Unix, PowerShell/cmd on Windows through
// ConPTY). Each session owns one server-allocated stream id; frames inside the stream carry a one-byte
// type prefix (see Frame* constants) so data, resize and close share a single channel.
package sessions

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"sync"
	"sync/atomic"
	"time"

	"github.com/cyberwizard2k26/nextjs-magicwand/agent/internal/logging"
	"github.com/cyberwizard2k26/nextjs-magicwand/agent/internal/protocol"
)

// Frame types (first byte of every payload on a terminal stream, both directions).
const (
	FrameData   byte = 0 // raw bytes (viewer keystrokes -> pty, pty output -> viewer)
	FrameResize byte = 1 // JSON {"cols":n,"rows":n} (viewer -> agent)
	FrameClose  byte = 2 // viewer -> agent: close; agent -> viewer: JSON {"exitCode":n,"reason":"..."}
	FrameReady  byte = 3 // agent -> viewer once the shell is running: JSON {"shell":"...","pid":n}
)

// Sender is the subset of the transport the manager needs.
type Sender interface {
	SendJSON(v interface{}) error
	SendBinary(streamID uint32, payload []byte) error
}

// Pty abstracts the OS-specific pseudo terminal.
type Pty interface {
	io.Reader
	io.Writer
	Resize(cols, rows int) error
	// Wait blocks until the shell exits and returns its exit code.
	Wait() (int, error)
	Close() error
	Pid() int
}

type Session struct {
	ID       string
	StreamID uint32
	Type     string
	Shell    string
	pty      Pty
	started  time.Time
	closed   chan struct{}
	once     sync.Once
	toPty    atomic.Int64 // viewer keystrokes written to the pty
	fromPty  atomic.Int64 // pty output sent to viewers
}

type OpenRequest struct {
	SessionID string `json:"sessionId"`
	Type      string `json:"type"`
	StreamID  uint32 `json:"streamId"`
	Shell     string `json:"shell"`
	RunAs     string `json:"runAs"`
	Cols      int    `json:"cols"`
	Rows      int    `json:"rows"`
	Cwd       string `json:"cwd"`
}

type Manager struct {
	mu       sync.Mutex
	byStream map[uint32]*Session
	byID     map[string]*Session
	sender   Sender
}

func NewManager(sender Sender) *Manager {
	return &Manager{byStream: map[uint32]*Session{}, byID: map[string]*Session{}, sender: sender}
}

// Open starts a terminal session and begins pumping its output to the stream.
func (m *Manager) Open(req OpenRequest) (*Session, error) {
	if req.Type != "terminal" {
		return nil, fmt.Errorf("session type %q is not supported by this agent", req.Type)
	}
	if req.SessionID == "" || req.StreamID == 0 {
		return nil, errors.New("sessionId and streamId are required")
	}
	if req.Cols <= 0 {
		req.Cols = 120
	}
	if req.Rows <= 0 {
		req.Rows = 32
	}
	m.mu.Lock()
	if _, dup := m.byStream[req.StreamID]; dup {
		m.mu.Unlock()
		return nil, fmt.Errorf("stream %d already in use", req.StreamID)
	}
	m.mu.Unlock()

	p, shell, err := startPty(req)
	if err != nil {
		return nil, err
	}
	s := &Session{ID: req.SessionID, StreamID: req.StreamID, Type: req.Type, Shell: shell, pty: p, started: time.Now(), closed: make(chan struct{})}
	m.mu.Lock()
	m.byStream[s.StreamID] = s
	m.byID[s.ID] = s
	m.mu.Unlock()

	ready, _ := json.Marshal(map[string]interface{}{"shell": shell, "pid": p.Pid(), "cols": req.Cols, "rows": req.Rows})
	_ = m.sender.SendBinary(s.StreamID, append([]byte{FrameReady}, ready...))
	_ = m.sender.SendJSON(protocol.SessionEvent{T: "session", SessionID: s.ID, Event: "started", StreamID: s.StreamID, Data: map[string]interface{}{"shell": shell, "pid": p.Pid()}})
	logging.Infof("terminal session %s started (%s, pid %d)", s.ID, shell, p.Pid())

	go m.pump(s)
	return s, nil
}

// pump copies pty output to the stream until the shell exits.
func (m *Manager) pump(s *Session) {
	buf := make([]byte, 32*1024)
	for {
		n, err := s.pty.Read(buf)
		if n > 0 {
			frame := make([]byte, 1+n)
			frame[0] = FrameData
			copy(frame[1:], buf[:n])
			s.fromPty.Add(int64(n))
			if serr := m.sender.SendBinary(s.StreamID, frame); serr != nil {
				logging.Warnf("terminal %s: send failed: %v", s.ID, serr)
				m.finish(s, -1, "transport closed")
				return
			}
		}
		if err != nil {
			code, _ := s.pty.Wait()
			m.finish(s, code, "shell exited")
			return
		}
	}
}

func (m *Manager) finish(s *Session, exitCode int, reason string) {
	s.once.Do(func() {
		_ = s.pty.Close()
		m.mu.Lock()
		delete(m.byStream, s.StreamID)
		delete(m.byID, s.ID)
		m.mu.Unlock()
		msg, _ := json.Marshal(map[string]interface{}{"exitCode": exitCode, "reason": reason})
		_ = m.sender.SendBinary(s.StreamID, append([]byte{FrameClose}, msg...))
		_ = m.sender.SendJSON(protocol.SessionEvent{T: "session", SessionID: s.ID, Event: "ended", StreamID: s.StreamID, Message: reason, Data: map[string]interface{}{"exitCode": exitCode, "durationMs": time.Since(s.started).Milliseconds(), "bytesToPty": s.toPty.Load(), "bytesFromPty": s.fromPty.Load()}})
		close(s.closed)
		logging.Infof("terminal session %s ended (%s, exit %d)", s.ID, reason, exitCode)
	})
}

// HandleFrame routes an inbound binary frame to its session. Unknown streams are ignored.
func (m *Manager) HandleFrame(streamID uint32, payload []byte) {
	m.mu.Lock()
	s := m.byStream[streamID]
	m.mu.Unlock()
	if s == nil || len(payload) == 0 {
		return
	}
	switch payload[0] {
	case FrameData:
		if len(payload) > 1 {
			n, _ := s.pty.Write(payload[1:])
			s.toPty.Add(int64(n))
		}
	case FrameResize:
		var sz struct {
			Cols int `json:"cols"`
			Rows int `json:"rows"`
		}
		if json.Unmarshal(payload[1:], &sz) == nil && sz.Cols > 0 && sz.Rows > 0 {
			_ = s.pty.Resize(sz.Cols, sz.Rows)
		}
	case FrameClose:
		m.finish(s, 0, "closed by viewer")
	}
}

// Close ends a session by id (no-op when unknown).
func (m *Manager) Close(sessionID string, reason string) bool {
	m.mu.Lock()
	s := m.byID[sessionID]
	m.mu.Unlock()
	if s == nil {
		return false
	}
	m.finish(s, 0, reason)
	return true
}

// CloseAll ends every session (agent stopping / reconnecting: stream ids are per connection).
func (m *Manager) CloseAll(reason string) {
	m.mu.Lock()
	all := make([]*Session, 0, len(m.byID))
	for _, s := range m.byID {
		all = append(all, s)
	}
	m.mu.Unlock()
	for _, s := range all {
		m.finish(s, 0, reason)
	}
}

func (m *Manager) Count() int {
	m.mu.Lock()
	defer m.mu.Unlock()
	return len(m.byID)
}
