import { pgTable, text, boolean, integer, real, jsonb, timestamp, index } from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { id, createdAt, updatedAt, ts, tsNullable } from "./_common";
import { organizations } from "./tenancy";
import { devices } from "./devices";

/* ---------------------------------------------------------------------------------------------
 * Monitoring, alerting, notification channels, escalation and maintenance windows
 * ------------------------------------------------------------------------------------------- */

export type MonitorType =
  | "cpu" | "memory" | "disk_space" | "disk_io" | "disk_smart" | "service" | "process" | "port" | "ping" | "http" | "dns" | "tcp"
  | "snmp" | "eventlog" | "syslog_pattern" | "script" | "windows_update" | "cert_expiry" | "file_exists" | "file_size" | "perf_counter"
  | "uptime" | "reboot_pending" | "agent_offline" | "battery" | "temperature" | "network_throughput" | "user_logon" | "software_present"
  | "software_absent" | "av_status" | "firewall_status" | "disk_encryption" | "backup_status" | "hardware_change" | "custom";

export type Severity = "info" | "low" | "medium" | "high" | "critical";
export type MonitorStatus = "ok" | "warning" | "critical" | "unknown" | "pending";

export interface MonitorThresholds {
  warning?: number;
  critical?: number;
  /** Compare operator for numeric monitors. */
  op?: ">" | "<" | ">=" | "<=" | "==" | "!=";
  /** Consecutive failures before alerting (flap suppression). */
  consecutive?: number;
  /** Sustained duration in seconds before alerting. */
  durationSeconds?: number;
}

export const monitors = pgTable(
  "monitors",
  {
    id: id(),
    orgId: text("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description"),
    type: text("type").$type<MonitorType>().notNull(),
    /** Type-specific configuration (service name, port, URL, OID, script id, counter path, etc.). */
    config: jsonb("config").$type<Record<string, unknown>>().notNull().default({}),
    thresholds: jsonb("thresholds").$type<MonitorThresholds>().notNull().default({}),
    intervalSeconds: integer("interval_seconds").notNull().default(60),
    severity: text("severity").$type<Severity>().notNull().default("medium"),
    enabled: boolean("enabled").notNull().default(true),
    /** Scope: where the monitor applies. policyId takes precedence (assigned via policies). */
    policyId: text("policy_id"),
    deviceId: text("device_id").references(() => devices.id, { onDelete: "cascade" }),
    groupId: text("group_id"),
    siteId: text("site_id"),
    platforms: jsonb("platforms").$type<string[]>().notNull().default([]),
    /** Run from the probe device instead of the target (for agentless / network checks). */
    runOnProbe: boolean("run_on_probe").notNull().default(false),
    autoRemediationScriptId: text("auto_remediation_script_id"),
    autoRemediationMaxPerDay: integer("auto_remediation_max_per_day").notNull().default(3),
    autoResolve: boolean("auto_resolve").notNull().default(true),
    autoResolveAfterSeconds: integer("auto_resolve_after_seconds").notNull().default(0),
    notificationChannelIds: jsonb("notification_channel_ids").$type<string[]>().notNull().default([]),
    escalationPolicyId: text("escalation_policy_id"),
    createTicket: boolean("create_ticket").notNull().default(false),
    tags: jsonb("tags").$type<string[]>().notNull().default([]),
    isBuiltin: boolean("is_builtin").notNull().default(false),
    createdBy: text("created_by"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("monitors_org_idx").on(t.orgId), index("monitors_device_idx").on(t.deviceId), index("monitors_policy_idx").on(t.policyId)],
);

/** Current state per (monitor, device) pair - updated in place every evaluation. */
export const monitorStates = pgTable(
  "monitor_states",
  {
    id: id(),
    monitorId: text("monitor_id").notNull().references(() => monitors.id, { onDelete: "cascade" }),
    deviceId: text("device_id").notNull().references(() => devices.id, { onDelete: "cascade" }),
    status: text("status").$type<MonitorStatus>().notNull().default("pending"),
    value: real("value"),
    message: text("message"),
    consecutiveFailures: integer("consecutive_failures").notNull().default(0),
    failingSince: tsNullable("failing_since"),
    lastCheckedAt: tsNullable("last_checked_at"),
    lastOkAt: tsNullable("last_ok_at"),
    alertId: text("alert_id"),
    remediationCountToday: integer("remediation_count_today").notNull().default(0),
    remediationDay: text("remediation_day"),
    data: jsonb("data").$type<Record<string, unknown>>().notNull().default({}),
    updatedAt: updatedAt(),
  },
  (t) => [index("monitor_states_monitor_device_idx").on(t.monitorId, t.deviceId), index("monitor_states_device_idx").on(t.deviceId)],
);

export const monitorResults = pgTable(
  "monitor_results",
  {
    id: id(),
    monitorId: text("monitor_id").notNull().references(() => monitors.id, { onDelete: "cascade" }),
    deviceId: text("device_id").notNull().references(() => devices.id, { onDelete: "cascade" }),
    ts: ts(),
    status: text("status").$type<MonitorStatus>().notNull(),
    value: real("value"),
    message: text("message"),
    durationMs: integer("duration_ms"),
  },
  (t) => [index("monitor_results_monitor_device_ts_idx").on(t.monitorId, t.deviceId, t.ts)],
);

export type AlertStatus = "open" | "acknowledged" | "resolved" | "suppressed" | "snoozed";

export const alerts = pgTable(
  "alerts",
  {
    id: id(),
    orgId: text("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    deviceId: text("device_id").references(() => devices.id, { onDelete: "cascade" }),
    monitorId: text("monitor_id").references(() => monitors.id, { onDelete: "set null" }),
    siteId: text("site_id"),
    severity: text("severity").$type<Severity>().notNull(),
    status: text("status").$type<AlertStatus>().notNull().default("open"),
    title: text("title").notNull(),
    message: text("message"),
    /** Deduplication key: same fingerprint while open increments `occurrences` instead of creating a new alert. */
    fingerprint: text("fingerprint").notNull(),
    occurrences: integer("occurrences").notNull().default(1),
    category: text("category").$type<"performance" | "availability" | "security" | "patching" | "hardware" | "software" | "backup" | "agent" | "network" | "other">().notNull().default("other"),
    source: text("source").$type<"monitor" | "agent" | "patch" | "automation" | "manual" | "ai" | "security" | "system">().notNull().default("monitor"),
    data: jsonb("data").$type<Record<string, unknown>>().notNull().default({}),
    openedAt: ts("opened_at"),
    lastSeenAt: ts("last_seen_at"),
    acknowledgedAt: tsNullable("acknowledged_at"),
    acknowledgedBy: text("acknowledged_by"),
    snoozedUntil: tsNullable("snoozed_until"),
    resolvedAt: tsNullable("resolved_at"),
    resolvedBy: text("resolved_by"),
    resolution: text("resolution"),
    ticketId: text("ticket_id"),
    escalationLevel: integer("escalation_level").notNull().default(0),
    lastNotifiedAt: tsNullable("last_notified_at"),
    remediationJobId: text("remediation_job_id"),
    aiTriage: jsonb("ai_triage").$type<{ summary: string; likelyCause?: string; suggestedActions?: string[]; confidence?: number; generatedAt: string } | null>(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("alerts_org_status_idx").on(t.orgId, t.status),
    index("alerts_device_idx").on(t.deviceId),
    index("alerts_fingerprint_idx").on(t.fingerprint, t.status),
    index("alerts_opened_idx").on(t.openedAt),
  ],
);

export const alertComments = pgTable(
  "alert_comments",
  {
    id: id(),
    alertId: text("alert_id").notNull().references(() => alerts.id, { onDelete: "cascade" }),
    authorId: text("author_id"),
    authorName: text("author_name"),
    body: text("body").notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("alert_comments_alert_idx").on(t.alertId)],
);

export type ChannelType = "email" | "webhook" | "slack" | "teams" | "discord" | "pagerduty" | "opsgenie" | "sms" | "telegram" | "pushover" | "ntfy" | "gotify" | "in_app" | "mobile_push";

export const notificationChannels = pgTable(
  "notification_channels",
  {
    id: id(),
    orgId: text("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    type: text("type").$type<ChannelType>().notNull(),
    name: text("name").notNull(),
    /** Encrypted at rest when it contains secrets (see lib/util/crypto.ts). */
    configEnc: text("config_enc"),
    config: jsonb("config").$type<Record<string, unknown>>().notNull().default({}),
    enabled: boolean("enabled").notNull().default(true),
    minSeverity: text("min_severity").$type<Severity>().notNull().default("info"),
    /** Quiet hours in the org timezone, e.g. { start: "22:00", end: "07:00", days: [0,6] } */
    quietHours: jsonb("quiet_hours").$type<{ start: string; end: string; days?: number[] } | null>(),
    lastUsedAt: tsNullable("last_used_at"),
    lastError: text("last_error"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("notification_channels_org_idx").on(t.orgId)],
);

export const escalationPolicies = pgTable(
  "escalation_policies",
  {
    id: id(),
    orgId: text("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description"),
    /** Ordered steps: notify these channels after N minutes without acknowledgement. */
    steps: jsonb("steps").$type<{ afterMinutes: number; channelIds: string[]; userIds?: string[]; repeat?: boolean }[]>().notNull().default([]),
    repeatCount: integer("repeat_count").notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("escalation_policies_org_idx").on(t.orgId)],
);

export const notifications = pgTable(
  "notifications",
  {
    id: id(),
    orgId: text("org_id").notNull(),
    channelId: text("channel_id").references(() => notificationChannels.id, { onDelete: "set null" }),
    alertId: text("alert_id").references(() => alerts.id, { onDelete: "cascade" }),
    kind: text("kind").notNull().default("alert"),
    status: text("status").$type<"queued" | "sent" | "failed" | "skipped">().notNull().default("queued"),
    attempts: integer("attempts").notNull().default(0),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
    error: text("error"),
    sentAt: tsNullable("sent_at"),
    createdAt: createdAt(),
  },
  (t) => [index("notifications_org_idx").on(t.orgId, t.createdAt)],
);

export const maintenanceWindows = pgTable(
  "maintenance_windows",
  {
    id: id(),
    orgId: text("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description"),
    targetType: text("target_type").$type<"org" | "site" | "group" | "device">().notNull(),
    targetIds: jsonb("target_ids").$type<string[]>().notNull().default([]),
    startsAt: timestamp("starts_at", { withTimezone: true, mode: "date" }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true, mode: "date" }).notNull(),
    /** RFC 5545 RRULE for recurring windows, e.g. FREQ=WEEKLY;BYDAY=SU;BYHOUR=2 */
    recurrence: text("recurrence"),
    timezone: text("timezone").notNull().default("UTC"),
    suppressAlerts: boolean("suppress_alerts").notNull().default(true),
    allowPatching: boolean("allow_patching").notNull().default(true),
    allowReboots: boolean("allow_reboots").notNull().default(true),
    createdBy: text("created_by"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("maintenance_windows_org_idx").on(t.orgId)],
);

/** In-app notification inbox (bell icon). */
export const inboxNotifications = pgTable(
  "inbox_notifications",
  {
    id: id(),
    userId: text("user_id").notNull(),
    orgId: text("org_id"),
    title: text("title").notNull(),
    body: text("body"),
    link: text("link"),
    severity: text("severity").$type<Severity>().notNull().default("info"),
    readAt: tsNullable("read_at"),
    createdAt: createdAt(),
  },
  (t) => [index("inbox_notifications_user_idx").on(t.userId, t.createdAt)],
);

export const alertsRelations = relations(alerts, ({ one, many }) => ({
  device: one(devices, { fields: [alerts.deviceId], references: [devices.id] }),
  monitor: one(monitors, { fields: [alerts.monitorId], references: [monitors.id] }),
  comments: many(alertComments),
}));
export const alertCommentsRelations = relations(alertComments, ({ one }) => ({ alert: one(alerts, { fields: [alertComments.alertId], references: [alerts.id] }) }));
export const monitorsRelations = relations(monitors, ({ many }) => ({ states: many(monitorStates) }));
export const monitorStatesRelations = relations(monitorStates, ({ one }) => ({
  monitor: one(monitors, { fields: [monitorStates.monitorId], references: [monitors.id] }),
  device: one(devices, { fields: [monitorStates.deviceId], references: [devices.id] }),
}));
