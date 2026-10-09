// Package identity manages the agent's stable id and its Ed25519 keypair used to authenticate with the server.
package identity

import (
	"crypto/ed25519"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"os"
	"path/filepath"
	"runtime"
	"strings"

	"github.com/shirou/gopsutil/v4/host"
)

type Identity struct {
	AgentID    string             `json:"agentId"`
	PrivateKey ed25519.PrivateKey `json:"-"`
	PublicKey  ed25519.PublicKey  `json:"-"`
}

type stored struct {
	AgentID    string `json:"agentId"`
	PrivateKey string `json:"privateKey"`
}

func path(dataDir string) string { return filepath.Join(dataDir, "identity.json") }

// LoadOrCreate returns the persisted identity or creates a new one.
func LoadOrCreate(dataDir string) (*Identity, error) {
	if b, err := os.ReadFile(path(dataDir)); err == nil {
		var s stored
		if json.Unmarshal(b, &s) == nil && s.AgentID != "" {
			if raw, err := base64.StdEncoding.DecodeString(s.PrivateKey); err == nil && len(raw) == ed25519.PrivateKeySize {
				priv := ed25519.PrivateKey(raw)
				return &Identity{AgentID: s.AgentID, PrivateKey: priv, PublicKey: priv.Public().(ed25519.PublicKey)}, nil
			}
		}
	}
	pub, priv, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		return nil, err
	}
	id := &Identity{AgentID: machineID(), PrivateKey: priv, PublicKey: pub}
	if err := id.save(dataDir); err != nil {
		return nil, err
	}
	return id, nil
}

func (i *Identity) save(dataDir string) error {
	if err := os.MkdirAll(dataDir, 0o755); err != nil {
		return err
	}
	b, _ := json.Marshal(stored{AgentID: i.AgentID, PrivateKey: base64.StdEncoding.EncodeToString(i.PrivateKey)})
	return os.WriteFile(path(dataDir), b, 0o600)
}

// Reset discards the identity (used by `uninstall --purge` and re-enrollment).
func Reset(dataDir string) error { return os.Remove(path(dataDir)) }

func (i *Identity) PublicKeyB64() string { return base64.StdEncoding.EncodeToString(i.PublicKey) }

func (i *Identity) Sign(nonce string) string {
	return base64.StdEncoding.EncodeToString(ed25519.Sign(i.PrivateKey, []byte(nonce)))
}

// machineID derives a stable id from the OS machine id plus a random component, so re-imaged clones
// with duplicated machine ids still get distinct agents once the identity file is regenerated.
func machineID() string {
	hid, _ := host.HostID()
	salt := make([]byte, 8)
	_, _ = rand.Read(salt)
	h := sha256.Sum256([]byte(strings.ToLower(hid) + runtime.GOOS + hex.EncodeToString(salt)))
	return hex.EncodeToString(h[:16])
}
