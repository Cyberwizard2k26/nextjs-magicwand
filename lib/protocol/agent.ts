/**
 * MagicWand agent <-> server protocol (v1).
 *
 * Transport: a single WebSocket (wss://server/agent/ws). Text frames carry JSON envelopes; binary
 * frames carry stream payloads (desktop frames, file chunks, terminal bytes) prefixed with a 4-byte
 * big-endian stream id. Every envelope is { t: type, id?: correlation id, ...payload }.
 *
 * The Go agent mirrors these definitions in agent/internal/protocol/messages.go. Keep both in sync and
 * document changes in docs/PROTOCOL.md.
 */
import { z } from "zod";

export const PROTOCOL_VERSION = 1;

/* ------------------------------------------------------------------ handshake */

export const AgentHello = z.object({
  t: z.literal("hello"),
  protocol: z.number().int(),
  agentId: z.string().min(8).max(128),
  agentVersion: z.string(),
  /** Enrollment token (first connection only) or empty when the agent already holds a device key. */
  enrollToken: z.string().optional(),
  /** Ed25519 public key (base64) - the agent signs the server nonce to prove identity after enrollment. */
  publicKey: z.string(),
  hostname: z.string(),
  platform: z.enum(["windows", "linux", "macos", "freebsd", "other"]),
  arch: z.string(),
  osName: z.string().optional(),
  osVersion: z.string().optional(),
  osBuild: z.string().optional(),
  kernel: z.string().optional(),
  capabilities: z.array(z.string()).default([]),
  /** Role flags, e.g. probe. */
  roles: z.array(z.string()).default([]),
  bootId: z.string().optional(),
  tz: z.string().optional(),
});
export type AgentHello = z.infer<typeof AgentHello>;

export const ServerChallenge = z.object({ t: z.literal("challenge"), nonce: z.string() });
export const AgentChallengeResponse = z.object({ t: z.literal("challenge_response"), signature: z.string() });

export const ServerWelcome = z.object({
  t: z.literal("welcome"),
  deviceId: z.string(),
  orgId: z.string(),
  serverTime: z.string(),
  heartbeatSeconds: z.number().int(),
  /** Agent configuration pushed by the server (collected intervals, feature switches, branding). */
  config: z.record(z.string(), z.unknown()),
  pendingApproval: z.boolean().default(false),
  serverVersion: z.string(),
});
export type ServerWelcome = z.infer<typeof ServerWelcome>;

/* ------------------------------------------------------------------ agent -> server */

export const Heartbeat = z.object({
  t: z.literal("heartbeat"),
  uptime: z.number().optional(),
  loggedInUsers: z.array(z.object({ user: z.string(), session: z.string(), type: z.string(), since: z.string().optional() })).optional(),
  publicIp: z.string().optional(),
  pendingReboot: z.boolean().optional(),
});

export const TelemetrySample = z.object({
  t: z.literal("telemetry"),
  ts: z.string(),
  cpuPercent: z.number().optional(),
  memUsedBytes: z.number().optional(),
  memTotalBytes: z.number().optional(),
  swapUsedBytes: z.number().optional(),
  disks: z.array(z.object({ mount: z.string(), usedBytes: z.number(), totalBytes: z.number(), readBps: z.number().optional(), writeBps: z.number().optional() })).optional(),
  netRxBps: z.number().optional(),
  netTxBps: z.number().optional(),
  uptimeSeconds: z.number().optional(),
  processCount: z.number().optional(),
  loadAvg: z.tuple([z.number(), z.number(), z.number()]).optional(),
  temperatures: z.array(z.object({ sensor: z.string(), celsius: z.number() })).optional(),
  batteryPercent: z.number().optional(),
  gpuPercent: z.number().optional(),
  topProcesses: z.array(z.object({ name: z.string(), pid: z.number(), cpu: z.number(), memBytes: z.number() })).optional(),
});

/** Full or partial inventory. Sections are optional so the agent can send deltas. */
export const Inventory = z.object({
  t: z.literal("inventory"),
  full: z.boolean().default(false),
  system: z
    .object({
      hostname: z.string().optional(),
      osName: z.string().optional(),
      osVersion: z.string().optional(),
      osBuild: z.string().optional(),
      kernel: z.string().optional(),
      arch: z.string().optional(),
      domain: z.string().optional(),
      serialNumber: z.string().optional(),
      manufacturer: z.string().optional(),
      model: z.string().optional(),
      deviceType: z.string().optional(),
      lastBootAt: z.string().optional(),
      timezone: z.string().optional(),
      localIps: z.array(z.string()).optional(),
      macAddresses: z.array(z.string()).optional(),
      loggedInUser: z.string().optional(),
      facts: z.record(z.string(), z.unknown()).optional(),
    })
    .optional(),
  hardware: z.record(z.string(), z.unknown()).optional(),
  software: z
    .array(z.object({ name: z.string(), version: z.string().optional(), publisher: z.string().optional(), installDate: z.string().optional(), source: z.string().optional(), sizeBytes: z.number().optional(), installLocation: z.string().optional(), uninstallString: z.string().optional(), isSystemComponent: z.boolean().optional() }))
    .optional(),
  services: z.array(z.object({ name: z.string(), displayName: z.string().optional(), status: z.string(), startType: z.string().optional(), account: z.string().optional(), pid: z.number().optional(), path: z.string().optional(), description: z.string().optional() })).optional(),
  localUsers: z.array(z.object({ username: z.string(), fullName: z.string().optional(), isAdmin: z.boolean().optional(), enabled: z.boolean().optional(), lastLogonAt: z.string().optional(), uid: z.string().optional(), passwordExpires: z.boolean().optional() })).optional(),
  security: z.record(z.string(), z.unknown()).optional(),
  patches: z.array(z.record(z.string(), z.unknown())).optional(),
  network: z.record(z.string(), z.unknown()).optional(),
  location: z.record(z.string(), z.unknown()).optional(),
});
export type Inventory = z.infer<typeof Inventory>;

export const DeviceEvent = z.object({
  t: z.literal("event"),
  ts: z.string().optional(),
  type: z.string(),
  severity: z.enum(["info", "warning", "error", "critical"]).default("info"),
  message: z.string(),
  source: z.enum(["agent", "oslog"]).default("agent"),
  data: z.record(z.string(), z.unknown()).optional(),
});

/** Result of a command previously sent by the server. Streaming output arrives as `output` chunks first. */
export const CommandOutput = z.object({ t: z.literal("output"), id: z.string(), stream: z.enum(["stdout", "stderr"]), data: z.string() });
export const CommandResult = z.object({
  t: z.literal("result"),
  id: z.string(),
  ok: z.boolean(),
  exitCode: z.number().optional(),
  stdout: z.string().optional(),
  stderr: z.string().optional(),
  error: z.string().optional(),
  /** Structured result (file listings, process lists, patch scan results ...). */
  data: z.unknown().optional(),
  durationMs: z.number().optional(),
});
export type CommandResult = z.infer<typeof CommandResult>;

export const MonitorReport = z.object({
  t: z.literal("monitor"),
  monitorId: z.string(),
  status: z.enum(["ok", "warning", "critical", "unknown"]),
  value: z.number().optional(),
  message: z.string().optional(),
  durationMs: z.number().optional(),
  data: z.record(z.string(), z.unknown()).optional(),
});

export const SessionEvent = z.object({
  t: z.literal("session"),
  sessionId: z.string(),
  event: z.enum(["consent_granted", "consent_denied", "consent_timeout", "started", "ended", "error", "user_disconnected"]),
  message: z.string().optional(),
  streamId: z.number().optional(),
  data: z.record(z.string(), z.unknown()).optional(),
});

export const ChatFromUser = z.object({ t: z.literal("chat"), body: z.string(), sessionId: z.string().optional(), user: z.string().optional() });
export const HelpRequest = z.object({ t: z.literal("help_request"), subject: z.string(), body: z.string().optional(), user: z.string().optional(), screenshot: z.string().optional() });
export const AgentLog = z.object({ t: z.literal("log"), level: z.enum(["debug", "info", "warn", "error"]), message: z.string(), data: z.record(z.string(), z.unknown()).optional() });

export const AgentMessage = z.discriminatedUnion("t", [
  AgentHello,
  AgentChallengeResponse,
  Heartbeat,
  TelemetrySample,
  Inventory,
  DeviceEvent,
  CommandOutput,
  CommandResult,
  MonitorReport,
  SessionEvent,
  ChatFromUser,
  HelpRequest,
  AgentLog,
]);
export type AgentMessage = z.infer<typeof AgentMessage>;

/* ------------------------------------------------------------------ server -> agent */

/** Every server->agent command carries an id used to correlate output/result messages. */
export const CommandTypes = [
  "run_script",
  "run_command",
  "inventory",
  "telemetry_now",
  "patch_scan",
  "patch_install",
  "software_install",
  "software_uninstall",
  "service_action",
  "process_list",
  "process_kill",
  "process_start",
  "file_list",
  "file_read",
  "file_write",
  "file_delete",
  "file_mkdir",
  "file_rename",
  "file_download",
  "file_upload",
  "file_hash",
  "file_search",
  "registry_list",
  "registry_get",
  "registry_set",
  "registry_delete",
  "eventlog_query",
  "reboot",
  "shutdown",
  "lock",
  "logoff",
  "sleep",
  "wake_on_lan",
  "message_user",
  "notify_user",
  "session_open",
  "session_close",
  "session_input",
  "session_control",
  "tunnel_open",
  "tunnel_close",
  "monitor_set",
  "monitor_run",
  "config_update",
  "agent_update",
  "agent_uninstall",
  "agent_restart",
  "agent_logs",
  "network_scan",
  "security_scan",
  "compliance_check",
  "local_user_action",
  "rotate_local_admin",
  "screenshot",
  "clipboard_get",
  "clipboard_set",
  "open_url",
  "speedtest",
  "ping",
  "traceroute",
  "dns_lookup",
  "port_check",
  "snmp_get",
  "snmp_walk",
  "power_plan",
  "task_scheduler_list",
  "task_scheduler_action",
  "printer_action",
  "certificate_list",
  "firewall_rule",
  "browser_extensions",
  "chat",
  "cancel",
] as const;
export type CommandType = (typeof CommandTypes)[number];

export const ServerCommand = z.object({
  t: z.literal("cmd"),
  id: z.string(),
  cmd: z.enum(CommandTypes),
  /** Command-specific arguments. */
  args: z.record(z.string(), z.unknown()).default({}),
  timeoutSeconds: z.number().int().positive().optional(),
  /** Run in the context of the logged-in user's desktop session instead of SYSTEM/root. */
  runAs: z.enum(["system", "user", "elevated_user"]).optional(),
  /** Stream stdout/stderr chunks as `output` messages while the command executes. */
  stream: z.boolean().optional(),
});
export type ServerCommand = z.infer<typeof ServerCommand>;

export const ServerMessage = z.discriminatedUnion("t", [
  ServerChallenge,
  ServerWelcome,
  ServerCommand,
  z.object({ t: z.literal("pong"), serverTime: z.string() }),
  z.object({ t: z.literal("config"), config: z.record(z.string(), z.unknown()) }),
  z.object({ t: z.literal("monitors"), monitors: z.array(z.object({ id: z.string(), type: z.string(), intervalSeconds: z.number(), config: z.record(z.string(), z.unknown()), thresholds: z.record(z.string(), z.unknown()) })) }),
  z.object({ t: z.literal("chat"), body: z.string(), from: z.string(), sessionId: z.string().optional() }),
  z.object({ t: z.literal("error"), code: z.string(), message: z.string(), fatal: z.boolean().optional() }),
  z.object({ t: z.literal("bye"), reason: z.string() }),
]);
export type ServerMessage = z.infer<typeof ServerMessage>;

/* ------------------------------------------------------------------ binary streams */

/** Binary frame header: uint32 streamId (big-endian) followed by payload. Stream ids are allocated by the server when a session is opened. */
export const STREAM_HEADER_BYTES = 4;
export function encodeStreamFrame(streamId: number, payload: Uint8Array): Uint8Array {
  const out = new Uint8Array(STREAM_HEADER_BYTES + payload.byteLength);
  new DataView(out.buffer).setUint32(0, streamId, false);
  out.set(payload, STREAM_HEADER_BYTES);
  return out;
}
export function decodeStreamFrame(frame: Uint8Array): { streamId: number; payload: Uint8Array } {
  const view = new DataView(frame.buffer, frame.byteOffset, frame.byteLength);
  return { streamId: view.getUint32(0, false), payload: frame.subarray(STREAM_HEADER_BYTES) };
}

/** Desktop stream payload types (first byte of payload inside a desktop stream frame). */
export const DesktopFrameType = {
  /** JPEG/WebP tile: [type=1][u16 x][u16 y][u16 w][u16 h][u8 monitor][image bytes] */
  TILE: 1,
  /** Full frame: [type=2][u16 w][u16 h][u8 monitor][image bytes] */
  FULL: 2,
  /** Cursor: [type=3][u16 x][u16 y][u8 shapeId] */
  CURSOR: 3,
  /** Monitor list changed: [type=4][json] */
  MONITORS: 4,
  /** Clipboard text from device: [type=5][utf8] */
  CLIPBOARD: 5,
  /** Input from viewer to device: [type=16][json {kind:"mouse"|"key"|"wheel"|"touch", ...}] */
  INPUT: 16,
  /** Viewer control: [type=17][json {quality, fps, monitor, scale, viewOnly}] */
  CONTROL: 17,
  /** Frame acknowledgement for flow control: [type=18][u32 seq] */
  ACK: 18,
} as const;

/** Capabilities an agent may announce in `hello`. */
export const AgentCapabilities = [
  "desktop", "terminal", "files", "processes", "services", "registry", "eventlog", "patching", "software", "scripts", "tunnels",
  "wol", "consent", "recording", "chat", "notifications", "tray", "probe", "snmp", "screenshot", "clipboard", "power", "compliance",
  "security_posture", "local_users", "scheduled_tasks", "printers", "certificates", "firewall", "browser_extensions", "webcam", "audio", "backstage",
] as const;
