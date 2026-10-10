/**
 * Monitors: what to watch, on which devices, with which thresholds. Four evaluation engines live in
 * monitor-evaluator.ts: `telemetry` (cpu/memory/disk/... from device.telemetry events), `heartbeat` (agent offline),
 * `inventory` (facts already in the database: pending reboot, patch age, software, posture, SMART) and `probe`
 * (a small JSON-emitting script run on the device every interval: service, process, port, ping, http, dns,
 * event log, certificate, file, custom script). Loaded at boot by the monitoring module: no Next imports.
 */
import { and, asc, desc, eq, ilike, inArray, isNull, or, sql, type SQL } from "drizzle-orm";
import { getDb, schema } from "../db";
import { bus } from "../bus";
import { groupsForDevice } from "./device-filter";
import type { MonitorThresholds, MonitorType, Severity } from "../db/schema/monitoring";

export type Monitor = typeof schema.monitors.$inferSelect;
export type MonitorState = typeof schema.monitorStates.$inferSelect;
export type MonitorEngine = "telemetry" | "heartbeat" | "inventory" | "probe";

export interface MonitorField { key: string; label: string; type: "string" | "number" | "boolean" | "select" | "list" | "text"; required?: boolean; hint?: string; placeholder?: string; options?: string[]; default?: unknown; platforms?: string[] }
export interface MonitorTypeDef {
  type: MonitorType;
  label: string;
  description: string;
  engine: MonitorEngine;
  /** Unit of `value` (for thresholds and display). */
  unit?: string;
  /** Default comparison operator for numeric thresholds. */
  op: MonitorThresholds["op"];
  /** Whether warning/critical thresholds apply (numeric check) or the check is pass/fail. */
  numeric: boolean;
  defaultThresholds: MonitorThresholds;
  defaultInterval: number;
  category: typeof schema.alerts.$inferSelect.category;
  fields: MonitorField[];
  platforms?: string[];
}

export const MONITOR_TYPES: MonitorTypeDef[] = [
  { type: "cpu", label: "CPU usage", description: "Average CPU utilisation from telemetry.", engine: "telemetry", unit: "%", op: ">", numeric: true, defaultThresholds: { warning: 85, critical: 95, op: ">", durationSeconds: 900 }, defaultInterval: 60, category: "performance", fields: [] },
  { type: "memory", label: "Memory usage", description: "Used memory as a percentage of total.", engine: "telemetry", unit: "%", op: ">", numeric: true, defaultThresholds: { warning: 85, critical: 95, op: ">", durationSeconds: 600 }, defaultInterval: 60, category: "performance", fields: [] },
  { type: "disk_space", label: "Disk space", description: "Highest used percentage across local volumes (or the listed mounts).", engine: "telemetry", unit: "%", op: ">", numeric: true, defaultThresholds: { warning: 85, critical: 95, op: ">" }, defaultInterval: 60, category: "hardware", fields: [
    { key: "mounts", label: "Only these mounts / drive letters", type: "list", hint: "Empty = every volume larger than the minimum size", placeholder: "C:\nD:\n/" },
    { key: "minSizeBytes", label: "Ignore volumes smaller than (bytes)", type: "number", default: 2_000_000_000 },
  ] },
  { type: "battery", label: "Battery level", description: "Battery charge from telemetry (laptops).", engine: "telemetry", unit: "%", op: "<", numeric: true, defaultThresholds: { warning: 20, critical: 10, op: "<" }, defaultInterval: 60, category: "hardware", fields: [] },
  { type: "temperature", label: "Temperature", description: "Hottest sensor reported by the agent.", engine: "telemetry", unit: "°C", op: ">", numeric: true, defaultThresholds: { warning: 80, critical: 95, op: ">", durationSeconds: 300 }, defaultInterval: 60, category: "hardware", fields: [] },
  { type: "uptime", label: "Uptime", description: "Days since the last boot - catch machines that never reboot.", engine: "telemetry", unit: "days", op: ">", numeric: true, defaultThresholds: { warning: 30, critical: 60, op: ">" }, defaultInterval: 300, category: "other", fields: [] },
  { type: "network_throughput", label: "Network throughput", description: "Combined receive + transmit rate.", engine: "telemetry", unit: "Mbit/s", op: ">", numeric: true, defaultThresholds: { warning: 500, critical: 900, op: ">", durationSeconds: 300 }, defaultInterval: 60, category: "network", fields: [] },
  { type: "agent_offline", label: "Device offline", description: "The agent has not checked in for longer than the threshold.", engine: "heartbeat", unit: "min", op: ">", numeric: true, defaultThresholds: { warning: 15, critical: 30, op: ">" }, defaultInterval: 60, category: "availability", fields: [] },
  { type: "reboot_pending", label: "Pending reboot", description: "A reboot has been pending for longer than the allowed number of days.", engine: "inventory", unit: "days", op: ">", numeric: true, defaultThresholds: { warning: 3, critical: 7, op: ">" }, defaultInterval: 900, category: "patching", fields: [] },
  { type: "windows_update", label: "Patch age", description: "Outstanding updates older than the allowed age (any OS).", engine: "inventory", unit: "updates", op: ">", numeric: true, defaultThresholds: { warning: 1, critical: 5, op: ">=" }, defaultInterval: 1800, category: "patching", fields: [
    { key: "maxAgeDays", label: "Count updates older than (days)", type: "number", default: 14 },
    { key: "severities", label: "Only these severities", type: "list", hint: "critical, important, moderate, low, unknown - empty = all", default: ["critical", "important"] },
    { key: "securityOnly", label: "Security updates only", type: "boolean", default: false },
  ] },
  { type: "software_present", label: "Software must be installed", description: "Alert when a required application is missing from the inventory.", engine: "inventory", op: "<", numeric: false, defaultThresholds: {}, defaultInterval: 1800, category: "software", fields: [{ key: "name", label: "Application name contains", type: "string", required: true, placeholder: "Sentinel" }] },
  { type: "software_absent", label: "Software must not be installed", description: "Alert when a forbidden application shows up in the inventory.", engine: "inventory", op: ">", numeric: false, defaultThresholds: {}, defaultInterval: 1800, category: "software", fields: [{ key: "name", label: "Application name contains", type: "string", required: true, placeholder: "uTorrent" }] },
  { type: "av_status", label: "Antivirus status", description: "Antivirus must be enabled and up to date (security posture).", engine: "inventory", op: "<", numeric: false, defaultThresholds: {}, defaultInterval: 1800, category: "security", fields: [] },
  { type: "firewall_status", label: "Firewall status", description: "Host firewall must be enabled.", engine: "inventory", op: "<", numeric: false, defaultThresholds: {}, defaultInterval: 1800, category: "security", fields: [] },
  { type: "disk_encryption", label: "Disk encryption", description: "Every reported volume must be encrypted (BitLocker / FileVault / LUKS).", engine: "inventory", op: "<", numeric: false, defaultThresholds: {}, defaultInterval: 3600, category: "security", fields: [] },
  { type: "disk_smart", label: "Disk health (SMART)", description: "Any disk reporting an unhealthy SMART status.", engine: "inventory", op: ">", numeric: false, defaultThresholds: {}, defaultInterval: 3600, category: "hardware", fields: [] },
  { type: "service", label: "Service", description: "Named services must be running. Services that are not installed are ignored.", engine: "probe", op: ">", numeric: false, defaultThresholds: { consecutive: 2 }, defaultInterval: 300, category: "availability", fields: [
    { key: "names", label: "Service names", type: "list", required: true, hint: "One per line (Windows service name, systemd unit or launchd label)", placeholder: "Spooler\nssh\ncron" },
  ] },
  { type: "process", label: "Process", description: "A process with this name must be running.", engine: "probe", unit: "procs", op: "<", numeric: true, defaultThresholds: { critical: 1, op: "<", consecutive: 2 }, defaultInterval: 300, category: "availability", fields: [{ key: "name", label: "Process name", type: "string", required: true, placeholder: "sqlservr" }] },
  { type: "port", label: "TCP port", description: "A TCP port must accept connections (checked from the device or from the server).", engine: "probe", unit: "ms", op: ">", numeric: false, defaultThresholds: { consecutive: 2 }, defaultInterval: 300, category: "network", fields: [
    { key: "host", label: "Host", type: "string", default: "127.0.0.1", hint: "Hostname or IP as seen from the device" },
    { key: "port", label: "Port", type: "number", required: true, placeholder: "443" },
    { key: "runFrom", label: "Check from", type: "select", options: ["agent", "server"], default: "agent" },
  ] },
  { type: "ping", label: "Ping", description: "ICMP reachability and round-trip time to a host.", engine: "probe", unit: "ms", op: ">", numeric: true, defaultThresholds: { warning: 150, critical: 400, op: ">", consecutive: 2 }, defaultInterval: 300, category: "network", fields: [{ key: "host", label: "Host", type: "string", required: true, placeholder: "8.8.8.8" }] },
  { type: "http", label: "HTTP(S) check", description: "URL must answer with the expected status (optionally containing text) within the response-time threshold.", engine: "probe", unit: "ms", op: ">", numeric: true, defaultThresholds: { warning: 2000, critical: 5000, op: ">", consecutive: 2 }, defaultInterval: 300, category: "availability", fields: [
    { key: "url", label: "URL", type: "string", required: true, placeholder: "https://intranet.local/health" },
    { key: "expectStatus", label: "Expected status code", type: "number", default: 200 },
    { key: "bodyContains", label: "Body must contain", type: "string" },
    { key: "runFrom", label: "Check from", type: "select", options: ["agent", "server"], default: "agent" },
  ] },
  { type: "dns", label: "DNS lookup", description: "A hostname must resolve (optionally to an expected address).", engine: "probe", op: ">", numeric: false, defaultThresholds: { consecutive: 2 }, defaultInterval: 300, category: "network", fields: [
    { key: "hostname", label: "Hostname", type: "string", required: true, placeholder: "dc01.corp.local" },
    { key: "expectIp", label: "Expected address", type: "string" },
    { key: "runFrom", label: "Check from", type: "select", options: ["agent", "server"], default: "agent" },
  ] },
  { type: "cert_expiry", label: "TLS certificate expiry", description: "Days until the certificate served by host:port expires.", engine: "probe", unit: "days", op: "<", numeric: true, defaultThresholds: { warning: 30, critical: 7, op: "<" }, defaultInterval: 3600, category: "security", fields: [
    { key: "host", label: "Host", type: "string", required: true, placeholder: "mail.example.com" },
    { key: "port", label: "Port", type: "number", default: 443 },
    { key: "runFrom", label: "Check from", type: "select", options: ["agent", "server"], default: "server" },
  ] },
  { type: "eventlog", label: "Event log / journal", description: "Count of matching log entries in the last interval (Windows event log or journald).", engine: "probe", unit: "events", op: ">", numeric: true, defaultThresholds: { warning: 5, critical: 20, op: ">=" }, defaultInterval: 900, category: "other", fields: [
    { key: "logName", label: "Log / unit", type: "string", default: "System", hint: "Windows: System, Application, Security … Linux: a systemd unit or empty for everything" },
    { key: "level", label: "Minimum level", type: "select", options: ["critical", "error", "warning"], default: "error" },
    { key: "pattern", label: "Message contains / event id", type: "string", placeholder: "7034 or 'disk'" },
    { key: "minutes", label: "Look back (minutes)", type: "number", default: 15 },
  ] },
  { type: "file_exists", label: "File exists", description: "A path must (or must not) exist.", engine: "probe", op: ">", numeric: false, defaultThresholds: {}, defaultInterval: 900, category: "other", fields: [
    { key: "path", label: "Path", type: "string", required: true, placeholder: "C:\\backup\\latest.ok" },
    { key: "expect", label: "Expectation", type: "select", options: ["exists", "missing"], default: "exists" },
  ] },
  { type: "file_size", label: "File / folder size", description: "Size in MB of a file or directory.", engine: "probe", unit: "MB", op: ">", numeric: true, defaultThresholds: { warning: 1024, critical: 4096, op: ">" }, defaultInterval: 3600, category: "other", fields: [{ key: "path", label: "Path", type: "string", required: true }] },
  { type: "backup_status", label: "Backup freshness", description: "Newest file under a path must be younger than the threshold (hours).", engine: "probe", unit: "hours", op: ">", numeric: true, defaultThresholds: { warning: 30, critical: 54, op: ">" }, defaultInterval: 3600, category: "backup", fields: [{ key: "path", label: "Backup folder", type: "string", required: true, placeholder: "/var/backups" }] },
  { type: "script", label: "Custom script", description: "Run a library script that prints JSON; `value` is compared to the thresholds, `status`/`message` are used when present.", engine: "probe", op: ">", numeric: true, defaultThresholds: {}, defaultInterval: 900, category: "other", fields: [
    { key: "scriptId", label: "Script", type: "string", required: true, hint: "Script with JSON output enabled" },
    { key: "valueKey", label: "Value key", type: "string", default: "value" },
    { key: "params", label: "Parameters (JSON)", type: "text", placeholder: "{\"path\": \"/data\"}" },
  ] },
];

export function monitorTypeDef(type: string): MonitorTypeDef | undefined {
  return MONITOR_TYPES.find((t) => t.type === type);
}

export function validateMonitorConfig(type: MonitorType, config: Record<string, unknown>): string | null {
  const def = monitorTypeDef(type);
  if (!def) return `Unsupported monitor type "${type}"`;
  for (const f of def.fields) {
    if (!f.required) continue;
    const v = config[f.key];
    const present = Array.isArray(v) ? v.length > 0 : v !== undefined && v !== null && String(v).trim() !== "";
    if (!present) return `${f.label} is required`;
  }
  if (type === "http" && !/^https?:\/\//i.test(String(config.url ?? ""))) return "URL must start with http:// or https://";
  if ((type === "port" || type === "cert_expiry") && config.port !== undefined && !(Number(config.port) >= 1 && Number(config.port) <= 65535)) return "Port must be 1-65535";
  if (type === "script" && config.params && typeof config.params === "string") { try { JSON.parse(config.params as string); } catch { return "Parameters must be valid JSON"; } }
  return null;
}

/** Apply type defaults for fields the caller left out. */
export function normaliseMonitorConfig(type: MonitorType, config: Record<string, unknown>): Record<string, unknown> {
  const def = monitorTypeDef(type);
  const out: Record<string, unknown> = { ...config };
  for (const f of def?.fields ?? []) if (out[f.key] === undefined && f.default !== undefined) out[f.key] = f.default;
  return out;
}

/* ------------------------------------------------------------------ built-in starter set */

export const BUILTIN_MONITORS: { key: string; name: string; type: MonitorType; config: Record<string, unknown>; thresholds: MonitorThresholds; severity: Severity; intervalSeconds: number; description: string; autoResolveAfterSeconds?: number }[] = [
  { key: "cpu-high", name: "High CPU for 15 minutes", type: "cpu", config: {}, thresholds: { warning: 90, critical: 98, op: ">", durationSeconds: 900 }, severity: "medium", intervalSeconds: 60, description: "CPU above 90% sustained for 15 minutes.", autoResolveAfterSeconds: 300 },
  { key: "disk-full", name: "Disk almost full", type: "disk_space", config: { minSizeBytes: 2_000_000_000 }, thresholds: { warning: 85, critical: 90, op: ">" }, severity: "high", intervalSeconds: 60, description: "Any volume above 90% used." },
  { key: "offline", name: "Device offline for 30 minutes", type: "agent_offline", config: {}, thresholds: { warning: 15, critical: 30, op: ">" }, severity: "medium", intervalSeconds: 60, description: "Agent has not checked in for 30 minutes." },
  { key: "critical-services", name: "Critical service stopped", type: "service", config: { names: ["Spooler", "LanmanServer", "Dnscache", "EventLog", "ssh", "sshd", "cron", "systemd-journald", "rsyslog", "com.apple.mDNSResponder"] }, thresholds: { consecutive: 2 }, severity: "high", intervalSeconds: 300, description: "Core OS services that are installed but not running." },
  { key: "reboot-pending", name: "Pending reboot older than 7 days", type: "reboot_pending", config: {}, thresholds: { warning: 3, critical: 7, op: ">" }, severity: "low", intervalSeconds: 900, description: "Updates are waiting for a reboot for more than a week." },
];

const seeded = new Set<string>();
/** Create the built-in starter monitors for an org once (cheap: one count query after the first call). */
export async function ensureBuiltinMonitors(orgId: string) {
  if (seeded.has(orgId)) return;
  const db = await getDb();
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(schema.monitors).where(and(eq(schema.monitors.orgId, orgId), eq(schema.monitors.isBuiltin, true)));
  if (n === 0) {
    await db.insert(schema.monitors).values(BUILTIN_MONITORS.map((m) => ({ orgId, name: m.name, description: m.description, type: m.type, config: normaliseMonitorConfig(m.type, m.config), thresholds: m.thresholds, intervalSeconds: m.intervalSeconds, severity: m.severity, enabled: true, isBuiltin: true, tags: ["starter", m.key], autoResolveAfterSeconds: m.autoResolveAfterSeconds ?? 0 })));
    bus.publish("monitor.created", { orgId, builtin: true, count: BUILTIN_MONITORS.length }, { orgId });
  }
  seeded.add(orgId);
}

/* ------------------------------------------------------------------ CRUD */

export interface MonitorListParams { orgId: string; q?: string; type?: string; engine?: MonitorEngine; enabled?: boolean; severity?: string; deviceId?: string; status?: string; siteIds?: string[]; sort?: string; dir?: "asc" | "desc"; page: number; pageSize: number }

export async function listMonitors(p: MonitorListParams) {
  const db = await getDb();
  const where: SQL[] = [eq(schema.monitors.orgId, p.orgId)];
  if (p.q) { const like = `%${p.q.replace(/[%_]/g, "\\$&")}%`; where.push(or(ilike(schema.monitors.name, like), ilike(schema.monitors.description, like))!); }
  if (p.type) where.push(eq(schema.monitors.type, p.type as MonitorType));
  if (p.engine) { const types = MONITOR_TYPES.filter((t) => t.engine === p.engine).map((t) => t.type); where.push(inArray(schema.monitors.type, types)); }
  if (p.enabled !== undefined) where.push(eq(schema.monitors.enabled, p.enabled));
  if (p.severity) where.push(eq(schema.monitors.severity, p.severity as Severity));
  if (p.deviceId) where.push(or(eq(schema.monitors.deviceId, p.deviceId), isNull(schema.monitors.deviceId))!);
  const order = p.sort === "name" ? (p.dir === "desc" ? desc(schema.monitors.name) : asc(schema.monitors.name)) : p.sort === "type" ? asc(schema.monitors.type) : p.sort === "severity" ? sql`case ${schema.monitors.severity} when 'critical' then 0 when 'high' then 1 when 'medium' then 2 when 'low' then 3 else 4 end` : p.sort === "updatedAt" ? desc(schema.monitors.updatedAt) : asc(schema.monitors.name);
  const [{ total }] = await db.select({ total: sql<number>`count(*)::int` }).from(schema.monitors).where(and(...where));
  const rows = await db.select().from(schema.monitors).where(and(...where)).orderBy(order).limit(p.pageSize).offset((p.page - 1) * p.pageSize);
  const ids = rows.map((r) => r.id);
  const stateRows = ids.length ? await db.select({ monitorId: schema.monitorStates.monitorId, status: schema.monitorStates.status, n: sql<number>`count(*)::int` }).from(schema.monitorStates).where(inArray(schema.monitorStates.monitorId, ids)).groupBy(schema.monitorStates.monitorId, schema.monitorStates.status) : [];
  const alertRows = ids.length ? await db.select({ monitorId: schema.alerts.monitorId, n: sql<number>`count(*)::int` }).from(schema.alerts).where(and(inArray(schema.alerts.monitorId, ids), inArray(schema.alerts.status, ["open", "acknowledged", "snoozed"]))).groupBy(schema.alerts.monitorId) : [];
  const items = rows.map((m) => {
    const counts: Record<string, number> = { ok: 0, warning: 0, critical: 0, unknown: 0, pending: 0 };
    for (const s of stateRows) if (s.monitorId === m.id) counts[s.status] = s.n;
    const def = monitorTypeDef(m.type);
    return { ...m, counts, devices: Object.values(counts).reduce((a, b) => a + b, 0), openAlerts: alertRows.find((a) => a.monitorId === m.id)?.n ?? 0, engine: def?.engine ?? "probe", typeLabel: def?.label ?? m.type, unit: def?.unit ?? null };
  });
  const filtered = p.status ? items.filter((i) => (p.status === "alerting" ? i.openAlerts > 0 : p.status === "ok" ? i.counts.critical + i.counts.warning === 0 && i.counts.ok > 0 : p.status === "warning" ? i.counts.warning > 0 : p.status === "critical" ? i.counts.critical > 0 : true)) : items;
  return { items: filtered, total, page: p.page, pageSize: p.pageSize, pages: Math.max(1, Math.ceil(total / p.pageSize)) };
}

export async function monitorSummary(orgId: string) {
  const db = await getDb();
  const [row] = await db.select({ total: sql<number>`count(*)::int`, enabled: sql<number>`count(*) filter (where ${schema.monitors.enabled})::int` }).from(schema.monitors).where(eq(schema.monitors.orgId, orgId));
  const states = await db.select({ status: schema.monitorStates.status, n: sql<number>`count(*)::int` }).from(schema.monitorStates).innerJoin(schema.monitors, eq(schema.monitors.id, schema.monitorStates.monitorId)).where(eq(schema.monitors.orgId, orgId)).groupBy(schema.monitorStates.status);
  const [alerts] = await db.select({ n: sql<number>`count(*)::int` }).from(schema.alerts).where(and(eq(schema.alerts.orgId, orgId), eq(schema.alerts.source, "monitor"), inArray(schema.alerts.status, ["open", "acknowledged"])));
  const byStatus: Record<string, number> = { ok: 0, warning: 0, critical: 0, unknown: 0, pending: 0 };
  for (const s of states) byStatus[s.status] = s.n;
  return { monitors: row.total, enabled: row.enabled, states: byStatus, openAlerts: alerts.n };
}

export async function getMonitor(id: string, orgId: string) {
  const db = await getDb();
  const [row] = await db.select().from(schema.monitors).where(and(eq(schema.monitors.id, id), eq(schema.monitors.orgId, orgId)));
  if (!row) return null;
  const def = monitorTypeDef(row.type);
  const [counts] = await db.select({ devices: sql<number>`count(*)::int`, ok: sql<number>`count(*) filter (where ${schema.monitorStates.status} = 'ok')::int`, warning: sql<number>`count(*) filter (where ${schema.monitorStates.status} = 'warning')::int`, critical: sql<number>`count(*) filter (where ${schema.monitorStates.status} = 'critical')::int`, unknown: sql<number>`count(*) filter (where ${schema.monitorStates.status} in ('unknown','pending'))::int` }).from(schema.monitorStates).where(eq(schema.monitorStates.monitorId, id));
  return { ...row, engine: def?.engine ?? "probe", typeLabel: def?.label ?? row.type, unit: def?.unit ?? null, counts };
}

export interface MonitorInput {
  name: string; description?: string | null; type: MonitorType; config?: Record<string, unknown>; thresholds?: MonitorThresholds; intervalSeconds?: number; severity?: Severity; enabled?: boolean;
  deviceId?: string | null; groupId?: string | null; siteId?: string | null; platforms?: string[]; autoRemediationScriptId?: string | null; autoRemediationMaxPerDay?: number; autoResolve?: boolean; autoResolveAfterSeconds?: number;
  notificationChannelIds?: string[]; escalationPolicyId?: string | null; createTicket?: boolean; tags?: string[];
}

export async function createMonitor(orgId: string, input: MonitorInput, createdBy: string | null) {
  const db = await getDb();
  const def = monitorTypeDef(input.type);
  if (!def) throw new Error(`Unsupported monitor type "${input.type}"`);
  const config = normaliseMonitorConfig(input.type, input.config ?? {});
  const err = validateMonitorConfig(input.type, config);
  if (err) throw new Error(err);
  const [row] = await db.insert(schema.monitors).values({
    orgId, name: input.name, description: input.description ?? null, type: input.type, config, thresholds: { ...def.defaultThresholds, ...(input.thresholds ?? {}) }, intervalSeconds: input.intervalSeconds ?? def.defaultInterval, severity: input.severity ?? "medium", enabled: input.enabled ?? true,
    deviceId: input.deviceId ?? null, groupId: input.groupId ?? null, siteId: input.siteId ?? null, platforms: input.platforms ?? [], autoRemediationScriptId: input.autoRemediationScriptId ?? null, autoRemediationMaxPerDay: input.autoRemediationMaxPerDay ?? 3, autoResolve: input.autoResolve ?? true, autoResolveAfterSeconds: input.autoResolveAfterSeconds ?? 0,
    notificationChannelIds: input.notificationChannelIds ?? [], escalationPolicyId: input.escalationPolicyId ?? null, createTicket: input.createTicket ?? false, tags: input.tags ?? [], createdBy,
  }).returning();
  bus.publish("monitor.created", { id: row.id, name: row.name, type: row.type }, { orgId });
  return row;
}

export async function updateMonitor(id: string, orgId: string, patch: Partial<MonitorInput>) {
  const db = await getDb();
  const [existing] = await db.select().from(schema.monitors).where(and(eq(schema.monitors.id, id), eq(schema.monitors.orgId, orgId)));
  if (!existing) return null;
  const type = existing.type;
  const set: Partial<typeof schema.monitors.$inferInsert> = {};
  for (const k of ["name", "description", "intervalSeconds", "severity", "enabled", "deviceId", "groupId", "siteId", "platforms", "autoRemediationScriptId", "autoRemediationMaxPerDay", "autoResolve", "autoResolveAfterSeconds", "notificationChannelIds", "escalationPolicyId", "createTicket", "tags"] as const) {
    if (patch[k] !== undefined) (set as Record<string, unknown>)[k] = patch[k];
  }
  if (patch.config) {
    const config = normaliseMonitorConfig(type, { ...existing.config, ...patch.config });
    const err = validateMonitorConfig(type, config);
    if (err) throw new Error(err);
    set.config = config;
  }
  if (patch.thresholds) set.thresholds = { ...existing.thresholds, ...patch.thresholds };
  const [row] = await db.update(schema.monitors).set(set).where(eq(schema.monitors.id, id)).returning();
  if (patch.enabled === false) {
    // Disabling a monitor closes its states; open alerts are resolved by the evaluator on the next tick.
    await db.delete(schema.monitorStates).where(eq(schema.monitorStates.monitorId, id));
  }
  bus.publish("monitor.updated", { id, name: row.name, enabled: row.enabled }, { orgId });
  return row;
}

export async function deleteMonitor(id: string, orgId: string) {
  const db = await getDb();
  const rows = await db.delete(schema.monitors).where(and(eq(schema.monitors.id, id), eq(schema.monitors.orgId, orgId))).returning({ id: schema.monitors.id, name: schema.monitors.name });
  if (!rows.length) return false;
  await db.update(schema.alerts).set({ status: "resolved", resolvedAt: new Date(), resolution: "Monitor deleted" }).where(and(eq(schema.alerts.monitorId, id), inArray(schema.alerts.status, ["open", "acknowledged", "snoozed", "suppressed"])));
  bus.publish("monitor.deleted", { id, name: rows[0].name }, { orgId });
  return true;
}

/** Per-device states of one monitor with device names and the recent result trend. */
export async function monitorStates(monitorId: string, opts: { status?: string; q?: string; page: number; pageSize: number; siteIds?: string[] }) {
  const db = await getDb();
  const where: SQL[] = [eq(schema.monitorStates.monitorId, monitorId)];
  if (opts.status) where.push(eq(schema.monitorStates.status, opts.status as MonitorState["status"]));
  if (opts.q) where.push(ilike(schema.devices.name, `%${opts.q.replace(/[%_]/g, "\\$&")}%`));
  if (opts.siteIds?.length) where.push(inArray(schema.devices.siteId, opts.siteIds));
  const [{ total }] = await db.select({ total: sql<number>`count(*)::int` }).from(schema.monitorStates).innerJoin(schema.devices, eq(schema.devices.id, schema.monitorStates.deviceId)).where(and(...where));
  const items = await db
    .select({ id: schema.monitorStates.id, deviceId: schema.monitorStates.deviceId, deviceName: schema.devices.name, devicePlatform: schema.devices.platform, deviceStatus: schema.devices.status, status: schema.monitorStates.status, value: schema.monitorStates.value, message: schema.monitorStates.message, consecutiveFailures: schema.monitorStates.consecutiveFailures, failingSince: schema.monitorStates.failingSince, lastCheckedAt: schema.monitorStates.lastCheckedAt, lastOkAt: schema.monitorStates.lastOkAt, alertId: schema.monitorStates.alertId, remediationCountToday: schema.monitorStates.remediationCountToday, data: schema.monitorStates.data, updatedAt: schema.monitorStates.updatedAt })
    .from(schema.monitorStates).innerJoin(schema.devices, eq(schema.devices.id, schema.monitorStates.deviceId)).where(and(...where))
    .orderBy(sql`case ${schema.monitorStates.status} when 'critical' then 0 when 'warning' then 1 when 'unknown' then 2 when 'pending' then 3 else 4 end`, asc(schema.devices.name)).limit(opts.pageSize).offset((opts.page - 1) * opts.pageSize);
  return { items, total, page: opts.page, pageSize: opts.pageSize, pages: Math.max(1, Math.ceil(total / opts.pageSize)) };
}

export async function monitorResultsFor(monitorId: string, deviceId: string, limit = 60) {
  const db = await getDb();
  return db.select({ ts: schema.monitorResults.ts, status: schema.monitorResults.status, value: schema.monitorResults.value, message: schema.monitorResults.message, durationMs: schema.monitorResults.durationMs }).from(schema.monitorResults).where(and(eq(schema.monitorResults.monitorId, monitorId), eq(schema.monitorResults.deviceId, deviceId))).orderBy(desc(schema.monitorResults.ts)).limit(limit);
}

/* ------------------------------------------------------------------ targeting */

type DeviceRow = typeof schema.devices.$inferSelect;

const monitorCache = new Map<string, { at: number; rows: Monitor[] }>();
bus.subscribe("monitor.*", (ev) => { if (ev.orgId) monitorCache.delete(ev.orgId); });

export async function enabledMonitors(orgId: string): Promise<Monitor[]> {
  const c = monitorCache.get(orgId);
  if (c && Date.now() - c.at < 30_000) return c.rows;
  const db = await getDb();
  const rows = await db.select().from(schema.monitors).where(and(eq(schema.monitors.orgId, orgId), eq(schema.monitors.enabled, true)));
  monitorCache.set(orgId, { at: Date.now(), rows });
  return rows;
}

export function monitorTargetsDevice(m: Monitor, device: Pick<DeviceRow, "id" | "siteId" | "platform">, groupIds: string[]): boolean {
  if (m.platforms.length && !m.platforms.includes(device.platform)) return false;
  if (m.deviceId) return m.deviceId === device.id;
  if (m.groupId) return groupIds.includes(m.groupId);
  if (m.siteId) return device.siteId === m.siteId;
  return true;
}

/** Enabled monitors that apply to a device, optionally only of one engine. */
export async function applicableMonitors(device: DeviceRow, engine?: MonitorEngine): Promise<Monitor[]> {
  const all = (await enabledMonitors(device.orgId)).filter((m) => !engine || monitorTypeDef(m.type)?.engine === engine);
  if (!all.length) return [];
  const groupIds = all.some((m) => m.groupId) ? await groupsForDevice(device) : [];
  return all.filter((m) => monitorTargetsDevice(m, device, groupIds));
}

/** Devices (active, not decommissioned) a monitor applies to. */
export async function monitorDevices(m: Monitor): Promise<DeviceRow[]> {
  const db = await getDb();
  const base = and(eq(schema.devices.orgId, m.orgId), inArray(schema.devices.status, ["online", "offline", "maintenance"]));
  let rows: DeviceRow[];
  if (m.deviceId) rows = await db.select().from(schema.devices).where(and(base, eq(schema.devices.id, m.deviceId)));
  else if (m.siteId) rows = await db.select().from(schema.devices).where(and(base, eq(schema.devices.siteId, m.siteId)));
  else {
    rows = await db.select().from(schema.devices).where(base);
    if (m.groupId) {
      const out: DeviceRow[] = [];
      for (const d of rows) if ((await groupsForDevice(d)).includes(m.groupId)) out.push(d);
      rows = out;
    }
  }
  return m.platforms.length ? rows.filter((d) => m.platforms.includes(d.platform)) : rows;
}
