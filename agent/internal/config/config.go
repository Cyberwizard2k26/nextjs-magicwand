// Package config loads the agent configuration from (in order of precedence) command-line flags,
// a config file in the agent data directory, and a configuration trailer appended to the binary by the
// server's installer builder. The trailer lets one pre-built executable be turned into a tenant-specific
// installer without recompiling.
package config

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
)

// TrailerMagic terminates an installer-stamped config: <json><8-byte big-endian length>MWCFGV1!
const TrailerMagic = "MWCFGV1!"

type Config struct {
	ServerURL   string `json:"serverUrl"`
	EnrollToken string `json:"enrollToken,omitempty"`
	// OrgName/SiteName are informational (shown in the tray/installer UI).
	OrgName  string `json:"orgName,omitempty"`
	SiteName string `json:"siteName,omitempty"`
	// Pin the server certificate SHA-256 fingerprint (optional, hex). Empty = system trust store.
	ServerCertFingerprint string `json:"serverCertFingerprint,omitempty"`
	// Allow self-signed / untrusted certificates (dev only).
	Insecure bool `json:"insecure,omitempty"`
	// Proxy URL (http/https/socks5). Empty = environment / direct.
	Proxy string `json:"proxy,omitempty"`
	// Device roles, e.g. ["probe"].
	Roles []string `json:"roles,omitempty"`
	// Tags applied at enrollment time (informational; the server also stamps tags from the token).
	Tags []string `json:"tags,omitempty"`
	// Branding shown in tray/notifications.
	ProductName string `json:"productName,omitempty"`
	// Log level: debug|info|warn|error
	LogLevel string `json:"logLevel,omitempty"`
	// Data directory override.
	DataDir string `json:"dataDir,omitempty"`
	// Disable self update.
	NoAutoUpdate bool `json:"noAutoUpdate,omitempty"`
	// Deep link back to the admin console shown after installation.
	ConsoleURL string `json:"consoleUrl,omitempty"`
}

// DefaultDataDir returns the per-OS directory for state (identity key, config, cache, logs).
func DefaultDataDir() string {
	switch runtime.GOOS {
	case "windows":
		base := os.Getenv("ProgramData")
		if base == "" {
			base = `C:\ProgramData`
		}
		return filepath.Join(base, "MagicWand", "Agent")
	case "darwin":
		return "/Library/Application Support/MagicWand/Agent"
	default:
		return "/var/lib/magicwand-agent"
	}
}

func FilePath(dataDir string) string { return filepath.Join(dataDir, "agent.json") }

// Load merges trailer -> file -> overrides.
func Load(dataDir string, overrides Config) (*Config, error) {
	cfg := &Config{}
	if t, err := ReadTrailer(); err == nil && t != nil {
		*cfg = *t
	}
	if b, err := os.ReadFile(FilePath(dataDir)); err == nil {
		var fileCfg Config
		if err := json.Unmarshal(b, &fileCfg); err == nil {
			merge(cfg, &fileCfg)
		}
	}
	merge(cfg, &overrides)
	if cfg.DataDir == "" {
		cfg.DataDir = dataDir
	}
	if cfg.ProductName == "" {
		cfg.ProductName = "MagicWand"
	}
	if cfg.ServerURL == "" {
		return cfg, errors.New("no server URL configured (use --server, agent.json, or an installer built from the console)")
	}
	return cfg, nil
}

func merge(dst, src *Config) {
	if src.ServerURL != "" {
		dst.ServerURL = src.ServerURL
	}
	if src.EnrollToken != "" {
		dst.EnrollToken = src.EnrollToken
	}
	if src.OrgName != "" {
		dst.OrgName = src.OrgName
	}
	if src.SiteName != "" {
		dst.SiteName = src.SiteName
	}
	if src.ServerCertFingerprint != "" {
		dst.ServerCertFingerprint = src.ServerCertFingerprint
	}
	if src.Insecure {
		dst.Insecure = true
	}
	if src.Proxy != "" {
		dst.Proxy = src.Proxy
	}
	if len(src.Roles) > 0 {
		dst.Roles = src.Roles
	}
	if len(src.Tags) > 0 {
		dst.Tags = src.Tags
	}
	if src.ProductName != "" {
		dst.ProductName = src.ProductName
	}
	if src.LogLevel != "" {
		dst.LogLevel = src.LogLevel
	}
	if src.DataDir != "" {
		dst.DataDir = src.DataDir
	}
	if src.NoAutoUpdate {
		dst.NoAutoUpdate = true
	}
	if src.ConsoleURL != "" {
		dst.ConsoleURL = src.ConsoleURL
	}
}

// Save writes the config file (0600) in the data directory.
func (c *Config) Save() error {
	if err := os.MkdirAll(c.DataDir, 0o755); err != nil {
		return err
	}
	b, err := json.MarshalIndent(c, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(FilePath(c.DataDir), b, 0o600)
}

// ReadTrailer looks for a config trailer at the end of the running executable.
func ReadTrailer() (*Config, error) {
	exe, err := os.Executable()
	if err != nil {
		return nil, err
	}
	return ReadTrailerFrom(exe)
}

func ReadTrailerFrom(path string) (*Config, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	st, err := f.Stat()
	if err != nil {
		return nil, err
	}
	const footer = 8 + len(TrailerMagic)
	if st.Size() < int64(footer) {
		return nil, nil
	}
	buf := make([]byte, footer)
	if _, err := f.ReadAt(buf, st.Size()-int64(footer)); err != nil {
		return nil, err
	}
	if !bytes.Equal(buf[8:], []byte(TrailerMagic)) {
		return nil, nil
	}
	n := int64(0)
	for i := 0; i < 8; i++ {
		n = n<<8 | int64(buf[i])
	}
	if n <= 0 || n > 1<<20 || st.Size() < int64(footer)+n {
		return nil, fmt.Errorf("invalid config trailer length %d", n)
	}
	payload := make([]byte, n)
	if _, err := f.ReadAt(payload, st.Size()-int64(footer)-n); err != nil {
		return nil, err
	}
	var cfg Config
	if err := json.Unmarshal(payload, &cfg); err != nil {
		return nil, fmt.Errorf("invalid config trailer: %w", err)
	}
	return &cfg, nil
}

// AppendTrailer stamps a config onto a copy of a binary (used by `magicwand-agent stamp` and tests;
// the server implements the same format in TypeScript).
func AppendTrailer(src, dst string, cfg *Config) error {
	in, err := os.ReadFile(src)
	if err != nil {
		return err
	}
	payload, err := json.Marshal(cfg)
	if err != nil {
		return err
	}
	out := make([]byte, 0, len(in)+len(payload)+16)
	out = append(out, in...)
	out = append(out, payload...)
	n := int64(len(payload))
	for i := 7; i >= 0; i-- {
		out = append(out, byte(n>>(uint(i)*8)))
	}
	out = append(out, []byte(TrailerMagic)...)
	return os.WriteFile(dst, out, 0o755)
}
