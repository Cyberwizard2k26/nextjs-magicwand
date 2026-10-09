// Package transport implements the agent side of the WebSocket protocol: connection, handshake,
// reconnection with jittered backoff, serialized writes and binary stream multiplexing.
package transport

import (
	"context"
	"crypto/sha256"
	"crypto/tls"
	"crypto/x509"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"math/rand"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"

	"github.com/gorilla/websocket"

	"github.com/cyberwizard2k26/nextjs-magicwand/agent/internal/config"
	"github.com/cyberwizard2k26/nextjs-magicwand/agent/internal/identity"
	"github.com/cyberwizard2k26/nextjs-magicwand/agent/internal/logging"
	"github.com/cyberwizard2k26/nextjs-magicwand/agent/internal/protocol"
)

// Handlers receive decoded server messages. All callbacks run on the read goroutine; long work must be
// dispatched to another goroutine.
type Handlers struct {
	OnWelcome  func(w *protocol.Welcome)
	OnCommand  func(c *protocol.Command)
	OnMonitors func(m *protocol.MonitorsMessage)
	OnConfig   func(cfg map[string]interface{})
	OnChat     func(c *protocol.ServerChat)
	OnBinary   func(streamID uint32, payload []byte)
	OnError    func(e *protocol.ServerError)
	OnClose    func(err error)
}

type Client struct {
	cfg      *config.Config
	id       *identity.Identity
	version  string
	hello    func() *protocol.Hello
	handlers Handlers

	mu      sync.Mutex
	conn    *websocket.Conn
	writeMu sync.Mutex
	ready   bool
	welcome *protocol.Welcome
}

func New(cfg *config.Config, id *identity.Identity, version string, hello func() *protocol.Hello, h Handlers) *Client {
	return &Client{cfg: cfg, id: id, version: version, hello: hello, handlers: h}
}

func (c *Client) IsReady() bool {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.ready
}

func (c *Client) Welcome() *protocol.Welcome {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.welcome
}

func (c *Client) wsURL() (string, error) {
	u, err := url.Parse(strings.TrimRight(c.cfg.ServerURL, "/"))
	if err != nil {
		return "", err
	}
	switch u.Scheme {
	case "https":
		u.Scheme = "wss"
	case "http":
		u.Scheme = "ws"
	case "ws", "wss":
	default:
		return "", fmt.Errorf("unsupported server URL scheme %q", u.Scheme)
	}
	u.Path = strings.TrimRight(u.Path, "/") + "/agent/ws"
	return u.String(), nil
}

func (c *Client) dialer() (*websocket.Dialer, error) {
	tlsCfg := &tls.Config{MinVersion: tls.VersionTLS12}
	if c.cfg.Insecure {
		tlsCfg.InsecureSkipVerify = true
	}
	if fp := strings.ToLower(strings.ReplaceAll(c.cfg.ServerCertFingerprint, ":", "")); fp != "" {
		// Pin the leaf certificate; works with self-signed certs too (skip chain verification, verify pin).
		tlsCfg.InsecureSkipVerify = true
		tlsCfg.VerifyPeerCertificate = func(raw [][]byte, _ [][]*x509.Certificate) error {
			if len(raw) == 0 {
				return errors.New("no certificate presented")
			}
			sum := sha256.Sum256(raw[0])
			if hex.EncodeToString(sum[:]) != fp {
				return errors.New("server certificate fingerprint mismatch")
			}
			return nil
		}
	}
	d := &websocket.Dialer{HandshakeTimeout: 20 * time.Second, TLSClientConfig: tlsCfg, Proxy: http.ProxyFromEnvironment, EnableCompression: false}
	if c.cfg.Proxy != "" {
		pu, err := url.Parse(c.cfg.Proxy)
		if err != nil {
			return nil, fmt.Errorf("invalid proxy: %w", err)
		}
		d.Proxy = http.ProxyURL(pu)
	}
	return d, nil
}

// Run connects and serves until ctx is cancelled, reconnecting with backoff. Returns when ctx ends.
func (c *Client) Run(ctx context.Context) {
	backoff := 2 * time.Second
	for {
		if ctx.Err() != nil {
			return
		}
		err := c.connectAndServe(ctx)
		c.mu.Lock()
		c.ready = false
		c.conn = nil
		c.mu.Unlock()
		if c.handlers.OnClose != nil {
			c.handlers.OnClose(err)
		}
		if ctx.Err() != nil {
			return
		}
		if err != nil {
			logging.Warnf("connection lost: %v (reconnecting in %s)", err, backoff)
		}
		jitter := time.Duration(rand.Int63n(int64(backoff / 2)))
		select {
		case <-ctx.Done():
			return
		case <-time.After(backoff + jitter):
		}
		if backoff < 2*time.Minute {
			backoff *= 2
		}
		if err == nil {
			backoff = 2 * time.Second
		}
	}
}

func (c *Client) connectAndServe(ctx context.Context) error {
	u, err := c.wsURL()
	if err != nil {
		return err
	}
	d, err := c.dialer()
	if err != nil {
		return err
	}
	hdr := http.Header{"User-Agent": {"MagicWand-Agent/" + c.version}}
	conn, resp, err := d.DialContext(ctx, u, hdr)
	if err != nil {
		if resp != nil {
			return fmt.Errorf("dial %s: %w (HTTP %d)", u, err, resp.StatusCode)
		}
		return fmt.Errorf("dial %s: %w", u, err)
	}
	defer conn.Close()
	conn.SetReadLimit(64 * 1024 * 1024)
	c.mu.Lock()
	c.conn = conn
	c.mu.Unlock()

	// ---- handshake ----
	hello := c.hello()
	hello.T = "hello"
	hello.Protocol = protocol.Version
	hello.AgentID = c.id.AgentID
	hello.AgentVersion = c.version
	hello.PublicKey = c.id.PublicKeyB64()
	hello.EnrollToken = c.cfg.EnrollToken
	if err := c.SendJSON(hello); err != nil {
		return err
	}
	_ = conn.SetReadDeadline(time.Now().Add(30 * time.Second))
	var ch protocol.Challenge
	if err := readJSON(conn, &ch); err != nil {
		return fmt.Errorf("challenge: %w", err)
	}
	if ch.T == "error" {
		return errors.New("server rejected hello")
	}
	if err := c.SendJSON(protocol.ChallengeResponse{T: "challenge_response", Signature: c.id.Sign(ch.Nonce)}); err != nil {
		return err
	}
	var env protocol.Envelope
	raw, err := readRaw(conn)
	if err != nil {
		return fmt.Errorf("welcome: %w", err)
	}
	_ = json.Unmarshal(raw, &env)
	if env.T == "error" {
		var e protocol.ServerError
		_ = json.Unmarshal(raw, &e)
		if c.handlers.OnError != nil {
			c.handlers.OnError(&e)
		}
		return fmt.Errorf("server error during handshake: %s (%s)", e.Message, e.Code)
	}
	var w protocol.Welcome
	if err := json.Unmarshal(raw, &w); err != nil || w.T != "welcome" {
		return fmt.Errorf("unexpected handshake reply %q", env.T)
	}
	c.mu.Lock()
	c.welcome = &w
	c.ready = true
	c.mu.Unlock()
	logging.Infof("connected to %s as device %s (server %s)", c.cfg.ServerURL, w.DeviceID, w.ServerVersion)
	if c.handlers.OnWelcome != nil {
		c.handlers.OnWelcome(&w)
	}

	// ---- steady state ----
	hb := time.Duration(w.HeartbeatSeconds) * time.Second
	if hb <= 0 {
		hb = 30 * time.Second
	}
	conn.SetPingHandler(func(data string) error {
		_ = conn.SetReadDeadline(time.Now().Add(hb * 3))
		c.writeMu.Lock()
		defer c.writeMu.Unlock()
		return conn.WriteControl(websocket.PongMessage, []byte(data), time.Now().Add(5*time.Second))
	})
	_ = conn.SetReadDeadline(time.Now().Add(hb * 3))
	for {
		if ctx.Err() != nil {
			c.writeMu.Lock()
			_ = conn.WriteMessage(websocket.CloseMessage, websocket.FormatCloseMessage(websocket.CloseGoingAway, "agent stopping"))
			c.writeMu.Unlock()
			return nil
		}
		mt, data, err := conn.ReadMessage()
		if err != nil {
			return err
		}
		_ = conn.SetReadDeadline(time.Now().Add(hb * 3))
		if mt == websocket.BinaryMessage {
			if len(data) >= 4 && c.handlers.OnBinary != nil {
				c.handlers.OnBinary(binary.BigEndian.Uint32(data[:4]), data[4:])
			}
			continue
		}
		var e protocol.Envelope
		if json.Unmarshal(data, &e) != nil {
			continue
		}
		switch e.T {
		case "cmd":
			var cmd protocol.Command
			if json.Unmarshal(data, &cmd) == nil && c.handlers.OnCommand != nil {
				c.handlers.OnCommand(&cmd)
			}
		case "monitors":
			var m protocol.MonitorsMessage
			if json.Unmarshal(data, &m) == nil && c.handlers.OnMonitors != nil {
				c.handlers.OnMonitors(&m)
			}
		case "config":
			var m struct {
				Config map[string]interface{} `json:"config"`
			}
			if json.Unmarshal(data, &m) == nil && c.handlers.OnConfig != nil {
				c.handlers.OnConfig(m.Config)
			}
		case "chat":
			var m protocol.ServerChat
			if json.Unmarshal(data, &m) == nil && c.handlers.OnChat != nil {
				c.handlers.OnChat(&m)
			}
		case "error":
			var m protocol.ServerError
			if json.Unmarshal(data, &m) == nil {
				if c.handlers.OnError != nil {
					c.handlers.OnError(&m)
				}
				if m.Fatal {
					return fmt.Errorf("fatal server error: %s", m.Message)
				}
			}
		case "bye":
			return errors.New("server closed the session")
		case "pong":
		}
	}
}

func readRaw(conn *websocket.Conn) ([]byte, error) {
	for {
		mt, data, err := conn.ReadMessage()
		if err != nil {
			return nil, err
		}
		if mt == websocket.TextMessage {
			return data, nil
		}
	}
}

func readJSON(conn *websocket.Conn, v interface{}) error {
	raw, err := readRaw(conn)
	if err != nil {
		return err
	}
	return json.Unmarshal(raw, v)
}

// SendJSON writes a text frame (safe for concurrent use).
func (c *Client) SendJSON(v interface{}) error {
	c.mu.Lock()
	conn := c.conn
	c.mu.Unlock()
	if conn == nil {
		return errors.New("not connected")
	}
	b, err := json.Marshal(v)
	if err != nil {
		return err
	}
	c.writeMu.Lock()
	defer c.writeMu.Unlock()
	_ = conn.SetWriteDeadline(time.Now().Add(30 * time.Second))
	return conn.WriteMessage(websocket.TextMessage, b)
}

// SendBinary writes a stream frame: [u32 streamId][payload].
func (c *Client) SendBinary(streamID uint32, payload []byte) error {
	c.mu.Lock()
	conn := c.conn
	c.mu.Unlock()
	if conn == nil {
		return errors.New("not connected")
	}
	buf := make([]byte, 4+len(payload))
	binary.BigEndian.PutUint32(buf[:4], streamID)
	copy(buf[4:], payload)
	c.writeMu.Lock()
	defer c.writeMu.Unlock()
	_ = conn.SetWriteDeadline(time.Now().Add(30 * time.Second))
	return conn.WriteMessage(websocket.BinaryMessage, buf)
}

// Close forces the current connection closed (Run will reconnect unless its context is done).
func (c *Client) Close() {
	c.mu.Lock()
	conn := c.conn
	c.mu.Unlock()
	if conn != nil {
		_ = conn.Close()
	}
}
