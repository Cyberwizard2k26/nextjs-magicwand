// Package protocol mirrors lib/protocol/agent.ts on the server. Keep both in sync (docs/PROTOCOL.md).
package protocol

import "encoding/json"

const Version = 1

// Envelope is the minimal shape used to sniff the message type before full decoding.
type Envelope struct {
	T  string `json:"t"`
	ID string `json:"id,omitempty"`
}

type LoggedInUser struct {
	User    string `json:"user"`
	Session string `json:"session"`
	Type    string `json:"type"`
	Since   string `json:"since,omitempty"`
}

type Hello struct {
	T            string   `json:"t"`
	Protocol     int      `json:"protocol"`
	AgentID      string   `json:"agentId"`
	AgentVersion string   `json:"agentVersion"`
	EnrollToken  string   `json:"enrollToken,omitempty"`
	PublicKey    string   `json:"publicKey"`
	Hostname     string   `json:"hostname"`
	Platform     string   `json:"platform"`
	Arch         string   `json:"arch"`
	OSName       string   `json:"osName,omitempty"`
	OSVersion    string   `json:"osVersion,omitempty"`
	OSBuild      string   `json:"osBuild,omitempty"`
	Kernel       string   `json:"kernel,omitempty"`
	Capabilities []string `json:"capabilities"`
	Roles        []string `json:"roles"`
	BootID       string   `json:"bootId,omitempty"`
	TZ           string   `json:"tz,omitempty"`
}

type Challenge struct {
	T     string `json:"t"`
	Nonce string `json:"nonce"`
}

type ChallengeResponse struct {
	T         string `json:"t"`
	Signature string `json:"signature"`
}

type Welcome struct {
	T                string                 `json:"t"`
	DeviceID         string                 `json:"deviceId"`
	OrgID            string                 `json:"orgId"`
	ServerTime       string                 `json:"serverTime"`
	HeartbeatSeconds int                    `json:"heartbeatSeconds"`
	Config           map[string]interface{} `json:"config"`
	PendingApproval  bool                   `json:"pendingApproval"`
	ServerVersion    string                 `json:"serverVersion"`
}

type Heartbeat struct {
	T             string         `json:"t"`
	Uptime        float64        `json:"uptime,omitempty"`
	LoggedInUsers []LoggedInUser `json:"loggedInUsers,omitempty"`
	PublicIP      string         `json:"publicIp,omitempty"`
	PendingReboot *bool          `json:"pendingReboot,omitempty"`
}

type DiskSample struct {
	Mount      string  `json:"mount"`
	UsedBytes  uint64  `json:"usedBytes"`
	TotalBytes uint64  `json:"totalBytes"`
	ReadBps    float64 `json:"readBps,omitempty"`
	WriteBps   float64 `json:"writeBps,omitempty"`
}

type TopProcess struct {
	Name     string  `json:"name"`
	PID      int32   `json:"pid"`
	CPU      float64 `json:"cpu"`
	MemBytes uint64  `json:"memBytes"`
}

type Temperature struct {
	Sensor  string  `json:"sensor"`
	Celsius float64 `json:"celsius"`
}

type Telemetry struct {
	T              string        `json:"t"`
	TS             string        `json:"ts"`
	CPUPercent     *float64      `json:"cpuPercent,omitempty"`
	MemUsedBytes   *uint64       `json:"memUsedBytes,omitempty"`
	MemTotalBytes  *uint64       `json:"memTotalBytes,omitempty"`
	SwapUsedBytes  *uint64       `json:"swapUsedBytes,omitempty"`
	Disks          []DiskSample  `json:"disks,omitempty"`
	NetRxBps       *float64      `json:"netRxBps,omitempty"`
	NetTxBps       *float64      `json:"netTxBps,omitempty"`
	UptimeSeconds  *uint64       `json:"uptimeSeconds,omitempty"`
	ProcessCount   *int          `json:"processCount,omitempty"`
	LoadAvg        *[3]float64   `json:"loadAvg,omitempty"`
	Temperatures   []Temperature `json:"temperatures,omitempty"`
	BatteryPercent *float64      `json:"batteryPercent,omitempty"`
	TopProcesses   []TopProcess  `json:"topProcesses,omitempty"`
}

type SystemInfo struct {
	Hostname     string                 `json:"hostname,omitempty"`
	OSName       string                 `json:"osName,omitempty"`
	OSVersion    string                 `json:"osVersion,omitempty"`
	OSBuild      string                 `json:"osBuild,omitempty"`
	Kernel       string                 `json:"kernel,omitempty"`
	Arch         string                 `json:"arch,omitempty"`
	Domain       string                 `json:"domain,omitempty"`
	SerialNumber string                 `json:"serialNumber,omitempty"`
	Manufacturer string                 `json:"manufacturer,omitempty"`
	Model        string                 `json:"model,omitempty"`
	DeviceType   string                 `json:"deviceType,omitempty"`
	LastBootAt   string                 `json:"lastBootAt,omitempty"`
	Timezone     string                 `json:"timezone,omitempty"`
	LocalIPs     []string               `json:"localIps,omitempty"`
	MacAddresses []string               `json:"macAddresses,omitempty"`
	LoggedInUser string                 `json:"loggedInUser,omitempty"`
	Facts        map[string]interface{} `json:"facts,omitempty"`
}

type Software struct {
	Name              string `json:"name"`
	Version           string `json:"version,omitempty"`
	Publisher         string `json:"publisher,omitempty"`
	InstallDate       string `json:"installDate,omitempty"`
	Source            string `json:"source,omitempty"`
	SizeBytes         uint64 `json:"sizeBytes,omitempty"`
	InstallLocation   string `json:"installLocation,omitempty"`
	UninstallString   string `json:"uninstallString,omitempty"`
	IsSystemComponent bool   `json:"isSystemComponent,omitempty"`
}

type Service struct {
	Name        string `json:"name"`
	DisplayName string `json:"displayName,omitempty"`
	Status      string `json:"status"`
	StartType   string `json:"startType,omitempty"`
	Account     string `json:"account,omitempty"`
	PID         int    `json:"pid,omitempty"`
	Path        string `json:"path,omitempty"`
	Description string `json:"description,omitempty"`
}

type LocalUser struct {
	Username        string `json:"username"`
	FullName        string `json:"fullName,omitempty"`
	IsAdmin         bool   `json:"isAdmin"`
	Enabled         bool   `json:"enabled"`
	LastLogonAt     string `json:"lastLogonAt,omitempty"`
	UID             string `json:"uid,omitempty"`
	PasswordExpires bool   `json:"passwordExpires"`
}

type Inventory struct {
	T          string                   `json:"t"`
	Full       bool                     `json:"full"`
	System     *SystemInfo              `json:"system,omitempty"`
	Hardware   map[string]interface{}   `json:"hardware,omitempty"`
	Software   []Software               `json:"software,omitempty"`
	Services   []Service                `json:"services,omitempty"`
	LocalUsers []LocalUser              `json:"localUsers,omitempty"`
	Security   map[string]interface{}   `json:"security,omitempty"`
	Patches    []map[string]interface{} `json:"patches,omitempty"`
	Network    map[string]interface{}   `json:"network,omitempty"`
	Location   map[string]interface{}   `json:"location,omitempty"`
}

type Event struct {
	T        string                 `json:"t"`
	TS       string                 `json:"ts,omitempty"`
	Type     string                 `json:"type"`
	Severity string                 `json:"severity"`
	Message  string                 `json:"message"`
	Source   string                 `json:"source"`
	Data     map[string]interface{} `json:"data,omitempty"`
}

type Output struct {
	T      string `json:"t"`
	ID     string `json:"id"`
	Stream string `json:"stream"`
	Data   string `json:"data"`
}

type Result struct {
	T          string      `json:"t"`
	ID         string      `json:"id"`
	OK         bool        `json:"ok"`
	ExitCode   *int        `json:"exitCode,omitempty"`
	Stdout     string      `json:"stdout,omitempty"`
	Stderr     string      `json:"stderr,omitempty"`
	Error      string      `json:"error,omitempty"`
	Data       interface{} `json:"data,omitempty"`
	DurationMs int64       `json:"durationMs,omitempty"`
}

type MonitorReport struct {
	T          string                 `json:"t"`
	MonitorID  string                 `json:"monitorId"`
	Status     string                 `json:"status"`
	Value      *float64               `json:"value,omitempty"`
	Message    string                 `json:"message,omitempty"`
	DurationMs int64                  `json:"durationMs,omitempty"`
	Data       map[string]interface{} `json:"data,omitempty"`
}

type SessionEvent struct {
	T         string                 `json:"t"`
	SessionID string                 `json:"sessionId"`
	Event     string                 `json:"event"`
	Message   string                 `json:"message,omitempty"`
	StreamID  uint32                 `json:"streamId,omitempty"`
	Data      map[string]interface{} `json:"data,omitempty"`
}

type Chat struct {
	T         string `json:"t"`
	Body      string `json:"body"`
	SessionID string `json:"sessionId,omitempty"`
	User      string `json:"user,omitempty"`
}

type HelpRequest struct {
	T          string `json:"t"`
	Subject    string `json:"subject"`
	Body       string `json:"body,omitempty"`
	User       string `json:"user,omitempty"`
	Screenshot string `json:"screenshot,omitempty"`
}

type Log struct {
	T       string                 `json:"t"`
	Level   string                 `json:"level"`
	Message string                 `json:"message"`
	Data    map[string]interface{} `json:"data,omitempty"`
}

// Command is a server -> agent request.
type Command struct {
	T              string          `json:"t"`
	ID             string          `json:"id"`
	Cmd            string          `json:"cmd"`
	Args           json.RawMessage `json:"args"`
	TimeoutSeconds int             `json:"timeoutSeconds,omitempty"`
	RunAs          string          `json:"runAs,omitempty"`
	Stream         bool            `json:"stream,omitempty"`
}

type MonitorSpec struct {
	ID              string                 `json:"id"`
	Type            string                 `json:"type"`
	IntervalSeconds int                    `json:"intervalSeconds"`
	Config          map[string]interface{} `json:"config"`
	Thresholds      map[string]interface{} `json:"thresholds"`
}

type MonitorsMessage struct {
	T        string        `json:"t"`
	Monitors []MonitorSpec `json:"monitors"`
}

type ServerChat struct {
	T         string `json:"t"`
	Body      string `json:"body"`
	From      string `json:"from"`
	SessionID string `json:"sessionId,omitempty"`
}

type ServerError struct {
	T       string `json:"t"`
	Code    string `json:"code"`
	Message string `json:"message"`
	Fatal   bool   `json:"fatal,omitempty"`
}

// Desktop stream payload types (first byte of a desktop stream frame).
const (
	DesktopTile     byte = 1
	DesktopFull     byte = 2
	DesktopCursor   byte = 3
	DesktopMonitors byte = 4
	DesktopClip     byte = 5
	DesktopInput    byte = 16
	DesktopControl  byte = 17
	DesktopAck      byte = 18
)

// Capabilities announced by this agent build. Only list what registerCommands/collectors actually implement:
// the console gates remote tools on these, so advertising "desktop" or "terminal" before they exist would
// show technicians buttons that cannot work.
var Capabilities = []string{"scripts", "terminal", "files", "processes", "power", "wol", "services", "local_users", "security_posture", "eventlog", "scheduled_tasks", "patching", "software", "screenshot", "notifications"}
