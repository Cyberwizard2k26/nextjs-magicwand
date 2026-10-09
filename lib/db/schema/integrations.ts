import { pgTable, text, boolean, integer, bigint, jsonb, index, uniqueIndex } from "drizzle-orm/pg-core";
import { id, createdAt, updatedAt, ts, tsNullable } from "./_common";
import { organizations } from "./tenancy";
import { devices } from "./devices";

/* ---------------------------------------------------------------------------------------------
 * Integrations (PSA, documentation, chat, identity, backup, security), outbound webhooks,
 * IT documentation & password vault, attachments, network discovery, reporting, AI, system.
 * ------------------------------------------------------------------------------------------- */

export type IntegrationType =
  | "psa_connectwise" | "psa_autotask" | "psa_halo" | "psa_syncro" | "psa_jira" | "psa_zendesk" | "psa_freshservice"
  | "docs_itglue" | "docs_hudu"
  | "chat_slack" | "chat_teams" | "chat_discord"
  | "identity_entra" | "identity_google" | "identity_okta" | "identity_ldap"
  | "backup_veeam" | "backup_acronis" | "backup_datto" | "backup_generic"
  | "security_defender" | "security_sentinelone" | "security_crowdstrike" | "security_bitdefender" | "security_huntress"
  | "mdm_intune" | "mdm_jamf"
  | "warranty_dell" | "warranty_lenovo" | "warranty_hp"
  | "oob_intel_amt" | "oob_redfish" | "oob_ipmi"
  | "vuln_osv" | "vuln_nvd"
  | "storage_s3" | "smtp" | "sms_twilio" | "generic_webhook" | "custom";

export const integrations = pgTable(
  "integrations",
  {
    id: id(),
    /** null = platform-wide (configured by the super admin). */
    orgId: text("org_id").references(() => organizations.id, { onDelete: "cascade" }),
    type: text("type").$type<IntegrationType>().notNull(),
    name: text("name").notNull(),
    enabled: boolean("enabled").notNull().default(true),
    /** Non-secret settings. */
    config: jsonb("config").$type<Record<string, unknown>>().notNull().default({}),
    /** AES-256-GCM encrypted JSON blob of credentials. */
    secretsEnc: text("secrets_enc"),
    status: text("status").$type<"ok" | "error" | "unconfigured" | "syncing">().notNull().default("unconfigured"),
    lastSyncAt: tsNullable("last_sync_at"),
    lastError: text("last_error"),
    syncIntervalMinutes: integer("sync_interval_minutes").notNull().default(60),
    /** Field mappings for PSA/docs sync (companies <-> orgs, configurations <-> devices ...). */
    mappings: jsonb("mappings").$type<Record<string, unknown>>().notNull().default({}),
    createdBy: text("created_by"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("integrations_org_idx").on(t.orgId), index("integrations_type_idx").on(t.type)],
);

export const webhooks = pgTable(
  "webhooks",
  {
    id: id(),
    orgId: text("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    url: text("url").notNull(),
    /** HMAC-SHA256 secret used to sign the payload (X-MagicWand-Signature). */
    secretEnc: text("secret_enc"),
    events: jsonb("events").$type<string[]>().notNull().default(["*"]),
    headers: jsonb("headers").$type<Record<string, string>>().notNull().default({}),
    enabled: boolean("enabled").notNull().default(true),
    failureCount: integer("failure_count").notNull().default(0),
    lastDeliveryAt: tsNullable("last_delivery_at"),
    lastStatus: integer("last_status"),
    createdBy: text("created_by"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("webhooks_org_idx").on(t.orgId)],
);

export const webhookDeliveries = pgTable(
  "webhook_deliveries",
  {
    id: id(),
    webhookId: text("webhook_id").notNull().references(() => webhooks.id, { onDelete: "cascade" }),
    event: text("event").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    status: text("status").$type<"pending" | "delivered" | "failed">().notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    responseCode: integer("response_code"),
    responseBody: text("response_body"),
    nextRetryAt: tsNullable("next_retry_at"),
    deliveredAt: tsNullable("delivered_at"),
    createdAt: createdAt(),
  },
  (t) => [index("webhook_deliveries_webhook_idx").on(t.webhookId, t.createdAt), index("webhook_deliveries_retry_idx").on(t.status, t.nextRetryAt)],
);

/* ---- IT documentation & vault ---- */

export const documents = pgTable(
  "documents",
  {
    id: id(),
    orgId: text("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    siteId: text("site_id"),
    deviceId: text("device_id").references(() => devices.id, { onDelete: "set null" }),
    title: text("title").notNull(),
    /** Markdown body. */
    body: text("body").notNull().default(""),
    category: text("category").$type<"runbook" | "kb" | "sop" | "configuration" | "network" | "vendor" | "onboarding" | "other">().notNull().default("other"),
    tags: jsonb("tags").$type<string[]>().notNull().default([]),
    isPublishedToPortal: boolean("is_published_to_portal").notNull().default(false),
    version: integer("version").notNull().default(1),
    /** Shown in the AI copilot context when answering questions about this org/device. */
    includeInAiContext: boolean("include_in_ai_context").notNull().default(true),
    createdBy: text("created_by"),
    updatedBy: text("updated_by"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("documents_org_idx").on(t.orgId), index("documents_device_idx").on(t.deviceId)],
);

export const vaultSecrets = pgTable(
  "vault_secrets",
  {
    id: id(),
    orgId: text("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    siteId: text("site_id"),
    deviceId: text("device_id").references(() => devices.id, { onDelete: "set null" }),
    name: text("name").notNull(),
    category: text("category").$type<"password" | "local_admin" | "api_key" | "certificate" | "ssh_key" | "wifi" | "license" | "note" | "other">().notNull().default("password"),
    username: text("username"),
    /** AES-256-GCM encrypted. Never returned by list endpoints; reveal is audited. */
    secretEnc: text("secret_enc").notNull(),
    url: text("url"),
    notes: text("notes"),
    totpSecretEnc: text("totp_secret_enc"),
    expiresAt: tsNullable("expires_at"),
    lastRotatedAt: tsNullable("last_rotated_at"),
    /** Automatic rotation by the local-admin-password feature (LAPS-like). */
    autoRotateDays: integer("auto_rotate_days"),
    createdBy: text("created_by"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("vault_secrets_org_idx").on(t.orgId), index("vault_secrets_device_idx").on(t.deviceId)],
);

export const deviceNotes = pgTable(
  "device_notes",
  {
    id: id(),
    deviceId: text("device_id").notNull().references(() => devices.id, { onDelete: "cascade" }),
    authorId: text("author_id"),
    authorName: text("author_name"),
    body: text("body").notNull(),
    pinned: boolean("pinned").notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("device_notes_device_idx").on(t.deviceId, t.createdAt)],
);

export const attachments = pgTable(
  "attachments",
  {
    id: id(),
    orgId: text("org_id").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id").notNull(),
    filename: text("filename").notNull(),
    mime: text("mime"),
    sizeBytes: bigint("size_bytes", { mode: "number" }).notNull(),
    /** Storage key relative to DATA_DIR/uploads (or S3 key). */
    storageKey: text("storage_key").notNull(),
    sha256: text("sha256"),
    uploadedBy: text("uploaded_by"),
    createdAt: createdAt(),
  },
  (t) => [index("attachments_entity_idx").on(t.entityType, t.entityId)],
);

/* ---- Network discovery ---- */

export const networkScans = pgTable(
  "network_scans",
  {
    id: id(),
    orgId: text("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    siteId: text("site_id"),
    probeDeviceId: text("probe_device_id").references(() => devices.id, { onDelete: "set null" }),
    targets: jsonb("targets").$type<string[]>().notNull(),
    methods: jsonb("methods").$type<("arp" | "ping" | "tcp" | "snmp" | "mdns" | "upnp" | "netbios")[]>().notNull().default(["arp", "ping"]),
    status: text("status").$type<"queued" | "running" | "completed" | "failed" | "cancelled">().notNull().default("queued"),
    foundCount: integer("found_count").notNull().default(0),
    newCount: integer("new_count").notNull().default(0),
    jobId: text("job_id"),
    startedAt: tsNullable("started_at"),
    finishedAt: tsNullable("finished_at"),
    error: text("error"),
    createdBy: text("created_by"),
    createdAt: createdAt(),
  },
  (t) => [index("network_scans_org_idx").on(t.orgId, t.createdAt)],
);

export const discoveredDevices = pgTable(
  "discovered_devices",
  {
    id: id(),
    orgId: text("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    siteId: text("site_id"),
    lastScanId: text("last_scan_id"),
    ip: text("ip").notNull(),
    mac: text("mac"),
    hostname: text("hostname"),
    vendor: text("vendor"),
    osGuess: text("os_guess"),
    deviceTypeGuess: text("device_type_guess"),
    openPorts: jsonb("open_ports").$type<{ port: number; proto: string; service?: string; banner?: string }[]>().notNull().default([]),
    snmp: jsonb("snmp").$type<{ sysName?: string; sysDescr?: string; sysObjectId?: string; uptime?: number; interfaces?: number } | null>(),
    services: jsonb("services").$type<Record<string, unknown>>().notNull().default({}),
    status: text("status").$type<"new" | "known" | "ignored" | "promoted">().notNull().default("new"),
    promotedDeviceId: text("promoted_device_id"),
    firstSeenAt: ts("first_seen_at"),
    lastSeenAt: ts("last_seen_at"),
  },
  (t) => [uniqueIndex("discovered_devices_org_site_ip_idx").on(t.orgId, t.siteId, t.ip), index("discovered_devices_status_idx").on(t.orgId, t.status)],
);

export const snmpProfiles = pgTable(
  "snmp_profiles",
  {
    id: id(),
    orgId: text("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    version: text("version").$type<"v1" | "v2c" | "v3">().notNull().default("v2c"),
    communityEnc: text("community_enc"),
    v3: jsonb("v3").$type<{ user?: string; authProtocol?: string; privProtocol?: string } | null>(),
    v3SecretsEnc: text("v3_secrets_enc"),
    port: integer("port").notNull().default(161),
    isDefault: boolean("is_default").notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [index("snmp_profiles_org_idx").on(t.orgId)],
);

/* ---- Reporting & dashboards ---- */

export const reports = pgTable(
  "reports",
  {
    id: id(),
    orgId: text("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    type: text("type").$type<"executive" | "patch_compliance" | "asset_inventory" | "software_inventory" | "alerts" | "security_posture" | "health" | "remote_sessions" | "tickets" | "warranty" | "license" | "custom">().notNull(),
    config: jsonb("config").$type<Record<string, unknown>>().notNull().default({}),
    schedule: text("schedule"),
    timezone: text("timezone").notNull().default("UTC"),
    recipients: jsonb("recipients").$type<string[]>().notNull().default([]),
    format: text("format").$type<"pdf" | "csv" | "html" | "json">().notNull().default("pdf"),
    enabled: boolean("enabled").notNull().default(true),
    brandForClient: boolean("brand_for_client").notNull().default(true),
    lastRunAt: tsNullable("last_run_at"),
    nextRunAt: tsNullable("next_run_at"),
    createdBy: text("created_by"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("reports_org_idx").on(t.orgId)],
);

export const reportRuns = pgTable(
  "report_runs",
  {
    id: id(),
    reportId: text("report_id").notNull().references(() => reports.id, { onDelete: "cascade" }),
    orgId: text("org_id").notNull(),
    status: text("status").$type<"running" | "completed" | "failed">().notNull().default("running"),
    storageKey: text("storage_key"),
    format: text("format"),
    sizeBytes: bigint("size_bytes", { mode: "number" }),
    error: text("error"),
    deliveredTo: jsonb("delivered_to").$type<string[]>().notNull().default([]),
    generatedAt: ts("generated_at"),
  },
  (t) => [index("report_runs_report_idx").on(t.reportId, t.generatedAt)],
);

export const dashboards = pgTable(
  "dashboards",
  {
    id: id(),
    orgId: text("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    userId: text("user_id"),
    name: text("name").notNull(),
    layout: jsonb("layout").$type<{ id: string; widget: string; x: number; y: number; w: number; h: number; config?: Record<string, unknown> }[]>().notNull().default([]),
    isDefault: boolean("is_default").notNull().default(false),
    isShared: boolean("is_shared").notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("dashboards_org_idx").on(t.orgId)],
);

/* ---- AI ---- */

export const aiConversations = pgTable(
  "ai_conversations",
  {
    id: id(),
    orgId: text("org_id").notNull(),
    userId: text("user_id").notNull(),
    deviceId: text("device_id"),
    title: text("title"),
    messages: jsonb("messages").$type<{ role: "user" | "assistant"; content: string; toolCalls?: unknown; ts: string }[]>().notNull().default([]),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("ai_conversations_user_idx").on(t.userId, t.updatedAt)],
);

export const aiInsights = pgTable(
  "ai_insights",
  {
    id: id(),
    orgId: text("org_id").notNull(),
    deviceId: text("device_id"),
    alertId: text("alert_id"),
    ticketId: text("ticket_id"),
    type: text("type").$type<"triage" | "anomaly" | "summary" | "recommendation" | "script_review" | "risk" | "capacity">().notNull(),
    title: text("title").notNull(),
    content: text("content").notNull(),
    confidence: integer("confidence"),
    data: jsonb("data").$type<Record<string, unknown>>().notNull().default({}),
    dismissedAt: tsNullable("dismissed_at"),
    createdAt: createdAt(),
  },
  (t) => [index("ai_insights_org_idx").on(t.orgId, t.createdAt), index("ai_insights_device_idx").on(t.deviceId)],
);

/* ---- System ---- */

export const settings = pgTable("settings", {
  key: text("key").primaryKey(),
  value: jsonb("value").$type<unknown>().notNull(),
  updatedAt: updatedAt(),
});

export const serverNodes = pgTable("server_nodes", {
  id: text("id").primaryKey(),
  hostname: text("hostname").notNull(),
  version: text("version").notNull(),
  startedAt: ts("started_at"),
  lastHeartbeatAt: ts("last_heartbeat_at"),
  agentConnections: integer("agent_connections").notNull().default(0),
  userConnections: integer("user_connections").notNull().default(0),
  isLeader: boolean("is_leader").notNull().default(false),
});

export const statusPages = pgTable(
  "status_pages",
  {
    id: id(),
    orgId: text("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    slug: text("slug").notNull(),
    title: text("title").notNull(),
    enabled: boolean("enabled").notNull().default(true),
    /** Components to display: device groups, monitors, or tunnels, each with a display name. */
    components: jsonb("components").$type<{ id: string; label: string; type: "group" | "device" | "monitor" | "site"; refId: string }[]>().notNull().default([]),
    accessTokenHash: text("access_token_hash"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("status_pages_slug_idx").on(t.slug)],
);
