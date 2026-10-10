/**
 * Notification channels: where alerts and automation notifications go. Email, generic webhook (HMAC signed),
 * Slack / Teams / Discord incoming webhooks, PagerDuty, Opsgenie, Telegram, Pushover, ntfy, Gotify and the in-app
 * inbox. Secret fields are AES-GCM encrypted in `configEnc`; the plain `config` column keeps only non-secret settings.
 * Every delivery is recorded in `notifications` (status, attempts, error). Loaded at boot: no Next imports.
 */
import { and, desc, eq, inArray, sql, type SQL } from "drizzle-orm";
import { getDb, schema } from "../db";
import { bus } from "../bus";
import { createLogger } from "../logger";
import { decryptJson, encryptJson, hmacSha256 } from "../util/crypto";
import { emailLayout, sendMail } from "./email";
import { notifyOrg } from "./inbox";
import { config as appConfig } from "../config";
import { zonedParts, isValidTimezone } from "./cron";
import type { ChannelType, Severity } from "../db/schema/monitoring";

const log = createLogger("notify");

export type NotificationChannel = typeof schema.notificationChannels.$inferSelect;

export interface ChannelField { key: string; label: string; type: "string" | "secret" | "url" | "list" | "boolean" | "select" | "number"; required?: boolean; hint?: string; placeholder?: string; options?: string[]; default?: unknown }
export interface ChannelTypeDef { type: ChannelType; label: string; description: string; fields: ChannelField[]; docsUrl?: string }

/** Catalogue consumed by the editor UI and the API (GET /notification-channels/types). */
export const CHANNEL_TYPES: ChannelTypeDef[] = [
  { type: "email", label: "Email", description: "Send to one or more addresses through the configured SMTP server.", fields: [
    { key: "to", label: "Recipients", type: "list", required: true, hint: "One address per line", placeholder: "noc@example.com" },
    { key: "subjectPrefix", label: "Subject prefix", type: "string", placeholder: "[MagicWand]" },
  ] },
  { type: "webhook", label: "Webhook", description: "POST a JSON document to any HTTPS endpoint, signed with HMAC-SHA256 (X-MagicWand-Signature).", fields: [
    { key: "url", label: "URL", type: "url", required: true, placeholder: "https://example.com/hooks/rmm" },
    { key: "method", label: "Method", type: "select", options: ["POST", "PUT"], default: "POST" },
    { key: "headers", label: "Extra headers", type: "list", hint: "Header: value, one per line" },
    { key: "secret", label: "Signing secret", type: "secret", hint: "Used for the X-MagicWand-Signature header" },
  ] },
  { type: "slack", label: "Slack", description: "Incoming webhook URL from a Slack app (Block Kit message).", fields: [{ key: "webhookUrl", label: "Incoming webhook URL", type: "secret", required: true, placeholder: "https://hooks.slack.com/services/…" }, { key: "channel", label: "Channel override", type: "string", placeholder: "#noc" }] },
  { type: "teams", label: "Microsoft Teams", description: "Incoming webhook or Workflow URL (Adaptive Card).", fields: [{ key: "webhookUrl", label: "Webhook URL", type: "secret", required: true }] },
  { type: "discord", label: "Discord", description: "Channel webhook URL (embed message).", fields: [{ key: "webhookUrl", label: "Webhook URL", type: "secret", required: true, placeholder: "https://discord.com/api/webhooks/…" }] },
  { type: "pagerduty", label: "PagerDuty", description: "Events API v2: triggers and resolves incidents by alert fingerprint.", fields: [{ key: "routingKey", label: "Integration (routing) key", type: "secret", required: true }] },
  { type: "opsgenie", label: "Opsgenie", description: "Alert API with alias deduplication.", fields: [{ key: "apiKey", label: "API key", type: "secret", required: true }, { key: "region", label: "Region", type: "select", options: ["us", "eu"], default: "us" }] },
  { type: "telegram", label: "Telegram", description: "Bot message to a chat or channel.", fields: [{ key: "botToken", label: "Bot token", type: "secret", required: true }, { key: "chatId", label: "Chat id", type: "string", required: true }] },
  { type: "pushover", label: "Pushover", description: "Push notification to a user or group key.", fields: [{ key: "appToken", label: "Application token", type: "secret", required: true }, { key: "userKey", label: "User / group key", type: "secret", required: true }] },
  { type: "ntfy", label: "ntfy", description: "Publish to an ntfy topic (self-hosted or ntfy.sh).", fields: [{ key: "server", label: "Server", type: "url", default: "https://ntfy.sh" }, { key: "topic", label: "Topic", type: "string", required: true }, { key: "token", label: "Access token", type: "secret" }] },
  { type: "gotify", label: "Gotify", description: "Self-hosted push server.", fields: [{ key: "server", label: "Server URL", type: "url", required: true }, { key: "token", label: "Application token", type: "secret", required: true }] },
  { type: "in_app", label: "In-app inbox", description: "Bell icon notifications for every member holding a permission.", fields: [{ key: "permission", label: "Deliver to members with permission", type: "select", options: ["alerts.view", "alerts.manage", "monitors.manage", "org.manage"], default: "alerts.manage" }] },
];

export const SEVERITY_RANK: Record<Severity, number> = { info: 0, low: 1, medium: 2, high: 3, critical: 4 };

export function channelTypeDef(type: string): ChannelTypeDef | undefined {
  return CHANNEL_TYPES.find((t) => t.type === type);
}

/** Split a raw config into (plain, secret) halves according to the type definition. */
export function splitConfig(type: ChannelType, raw: Record<string, unknown>): { plain: Record<string, unknown>; secret: Record<string, unknown> } {
  const def = channelTypeDef(type);
  const plain: Record<string, unknown> = {};
  const secret: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (v === undefined || v === "") continue;
    const f = def?.fields.find((x) => x.key === k);
    if (f?.type === "secret") secret[k] = v;
    else plain[k] = v;
  }
  return { plain, secret };
}

export function decryptedConfig(ch: Pick<NotificationChannel, "config" | "configEnc">): Record<string, unknown> {
  let secret: Record<string, unknown> = {};
  if (ch.configEnc) {
    try { secret = decryptJson<Record<string, unknown>>(ch.configEnc); } catch (err) { log.warn("channel secrets undecryptable", { err: String(err) }); }
  }
  return { ...ch.config, ...secret };
}

/** API representation: never returns secrets, only which secret keys are set. */
export function publicChannel(ch: NotificationChannel) {
  const def = channelTypeDef(ch.type);
  let secretKeys: string[] = [];
  if (ch.configEnc) { try { secretKeys = Object.keys(decryptJson<Record<string, unknown>>(ch.configEnc)); } catch { secretKeys = []; } }
  const { configEnc: _enc, ...rest } = ch;
  void _enc;
  return { ...rest, secretKeys, typeLabel: def?.label ?? ch.type, isDefault: ch.config.isDefault === true };
}

/* ------------------------------------------------------------------ CRUD */

export interface ChannelInput { type: ChannelType; name: string; config: Record<string, unknown>; enabled?: boolean; minSeverity?: Severity; quietHours?: { start: string; end: string; days?: number[] } | null }

export function validateChannelConfig(type: ChannelType, cfg: Record<string, unknown>, existingSecretKeys: string[] = []): string | null {
  const def = channelTypeDef(type);
  if (!def) return `Unsupported channel type "${type}"`;
  for (const f of def.fields) {
    if (!f.required) continue;
    const v = cfg[f.key];
    const present = Array.isArray(v) ? v.length > 0 : v !== undefined && v !== null && String(v).trim() !== "";
    if (!present && !(f.type === "secret" && existingSecretKeys.includes(f.key))) return `${f.label} is required`;
    if ((f.type === "url" || (f.type === "secret" && f.key.toLowerCase().includes("url"))) && present && !/^https?:\/\//i.test(String(v))) return `${f.label} must be an http(s) URL`;
  }
  return null;
}

export async function listChannels(orgId: string, opts: { q?: string; type?: string; enabled?: boolean } = {}) {
  const db = await getDb();
  const where: SQL[] = [eq(schema.notificationChannels.orgId, orgId)];
  if (opts.type) where.push(eq(schema.notificationChannels.type, opts.type as ChannelType));
  if (opts.enabled !== undefined) where.push(eq(schema.notificationChannels.enabled, opts.enabled));
  if (opts.q) where.push(sql`${schema.notificationChannels.name} ilike ${"%" + opts.q.replace(/[%_]/g, "\\$&") + "%"}`);
  const rows = await db.select().from(schema.notificationChannels).where(and(...where)).orderBy(schema.notificationChannels.name);
  const stats = await db.select({ channelId: schema.notifications.channelId, status: schema.notifications.status, n: sql<number>`count(*)::int` }).from(schema.notifications).where(and(eq(schema.notifications.orgId, orgId), sql`${schema.notifications.createdAt} > now() - interval '7 days'`)).groupBy(schema.notifications.channelId, schema.notifications.status);
  return rows.map((r) => ({ ...publicChannel(r), last7d: { sent: stats.filter((s) => s.channelId === r.id && s.status === "sent").reduce((a, s) => a + s.n, 0), failed: stats.filter((s) => s.channelId === r.id && s.status === "failed").reduce((a, s) => a + s.n, 0) } }));
}

export async function getChannel(id: string, orgId: string) {
  const db = await getDb();
  const [row] = await db.select().from(schema.notificationChannels).where(and(eq(schema.notificationChannels.id, id), eq(schema.notificationChannels.orgId, orgId)));
  return row ?? null;
}

export async function createChannel(orgId: string, input: ChannelInput) {
  const db = await getDb();
  const err = validateChannelConfig(input.type, input.config);
  if (err) throw new Error(err);
  const { plain, secret } = splitConfig(input.type, input.config);
  const [row] = await db.insert(schema.notificationChannels).values({ orgId, type: input.type, name: input.name, config: plain, configEnc: Object.keys(secret).length ? encryptJson(secret) : null, enabled: input.enabled ?? true, minSeverity: input.minSeverity ?? "info", quietHours: input.quietHours ?? null }).returning();
  bus.publish("notification_channel.created", { id: row.id, name: row.name, type: row.type }, { orgId });
  return publicChannel(row);
}

export async function updateChannel(id: string, orgId: string, patch: Partial<ChannelInput>) {
  const db = await getDb();
  const existing = await getChannel(id, orgId);
  if (!existing) return null;
  const set: Partial<typeof schema.notificationChannels.$inferInsert> = {};
  if (patch.name !== undefined) set.name = patch.name;
  if (patch.enabled !== undefined) set.enabled = patch.enabled;
  if (patch.minSeverity !== undefined) set.minSeverity = patch.minSeverity;
  if (patch.quietHours !== undefined) set.quietHours = patch.quietHours;
  if (patch.config) {
    const currentSecret = existing.configEnc ? (() => { try { return decryptJson<Record<string, unknown>>(existing.configEnc!); } catch { return {}; } })() : {};
    const err = validateChannelConfig(existing.type, { ...existing.config, ...patch.config }, Object.keys(currentSecret));
    if (err) throw new Error(err);
    const { plain, secret } = splitConfig(existing.type, patch.config);
    const mergedSecret = { ...currentSecret, ...secret };
    set.config = plain;
    set.configEnc = Object.keys(mergedSecret).length ? encryptJson(mergedSecret) : null;
    set.lastError = null;
  }
  const [row] = await db.update(schema.notificationChannels).set(set).where(and(eq(schema.notificationChannels.id, id), eq(schema.notificationChannels.orgId, orgId))).returning();
  bus.publish("notification_channel.updated", { id, name: row.name }, { orgId });
  return publicChannel(row);
}

export async function deleteChannel(id: string, orgId: string) {
  const db = await getDb();
  const rows = await db.delete(schema.notificationChannels).where(and(eq(schema.notificationChannels.id, id), eq(schema.notificationChannels.orgId, orgId))).returning({ id: schema.notificationChannels.id, name: schema.notificationChannels.name });
  if (rows.length) bus.publish("notification_channel.deleted", { id, name: rows[0].name }, { orgId });
  return rows.length > 0;
}

/* ------------------------------------------------------------------ delivery */

export interface Notification {
  title: string;
  body?: string;
  severity?: Severity;
  link?: string;
  /** "alert" | "recovery" | "automation" | "test" | "escalation" | "schedule" ... */
  kind?: string;
  alertId?: string | null;
  deviceName?: string | null;
  /** Stable key for providers that deduplicate (PagerDuty dedup_key / Opsgenie alias). */
  dedupKey?: string;
  /** For recovery notices: resolve the incident instead of triggering one. */
  resolve?: boolean;
  data?: Record<string, unknown>;
}

const SEVERITY_COLOR: Record<Severity, string> = { info: "#3b82f6", low: "#22c55e", medium: "#f59e0b", high: "#ef4444", critical: "#b91c1c" };

function absoluteLink(link?: string) {
  if (!link) return undefined;
  return link.startsWith("http") ? link : `${appConfig.publicUrl}${link.startsWith("/") ? "" : "/"}${link}`;
}

/** Quiet hours in the given timezone: { start: "22:00", end: "07:00", days: [0,6] } (days optional = every day). */
export function inQuietHours(q: { start: string; end: string; days?: number[] } | null | undefined, now = new Date(), tz = "UTC"): boolean {
  if (!q?.start || !q?.end) return false;
  const p = zonedParts(now, isValidTimezone(tz) ? tz : "UTC");
  if (q.days?.length && !q.days.includes(p.weekday)) return false;
  const toMin = (s: string) => { const [h, m] = s.split(":").map((x) => Number.parseInt(x, 10)); return (h || 0) * 60 + (m || 0); };
  const cur = p.hour * 60 + p.minute, start = toMin(q.start), end = toMin(q.end);
  return start <= end ? cur >= start && cur < end : cur >= start || cur < end;
}

async function postJson(url: string, body: unknown, headers: Record<string, string> = {}, method = "POST"): Promise<{ status: number; text: string }> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15_000);
  try {
    const res = await fetch(url, { method, headers: { "content-type": "application/json", "user-agent": "MagicWand-RMM/1.0", ...headers }, body: JSON.stringify(body), signal: ctrl.signal });
    const text = (await res.text().catch(() => "")).slice(0, 2000);
    return { status: res.status, text };
  } finally { clearTimeout(timer); }
}
function ensureOk(r: { status: number; text: string }) {
  if (r.status < 200 || r.status >= 300) throw new Error(`HTTP ${r.status}${r.text ? `: ${r.text.slice(0, 200)}` : ""}`);
}

async function deliver(ch: NotificationChannel, cfg: Record<string, unknown>, n: Notification, orgId: string): Promise<void> {
  const sev = n.severity ?? "info";
  const link = absoluteLink(n.link);
  const text = [n.body, link ? `Open: ${link}` : null].filter(Boolean).join("\n\n");
  const title = `${n.resolve ? "[Resolved] " : ""}${n.title}`;
  switch (ch.type) {
    case "email": {
      const to = Array.isArray(cfg.to) ? (cfg.to as string[]) : String(cfg.to ?? "").split(/[\n,;]+/).map((s) => s.trim()).filter(Boolean);
      if (!to.length) throw new Error("No recipients configured");
      const subject = `${cfg.subjectPrefix ? `${cfg.subjectPrefix} ` : ""}${n.resolve ? "Resolved: " : `[${sev.toUpperCase()}] `}${n.title}${n.deviceName ? ` · ${n.deviceName}` : ""}`;
      const r = await sendMail({ to, subject, text, html: emailLayout({ title, body: `${n.body ? `<p>${escapeHtml(n.body).replace(/\n/g, "<br>")}</p>` : ""}${n.deviceName ? `<p style="color:#8b93a7">Device: ${escapeHtml(n.deviceName)}</p>` : ""}<p>Severity: <b style="color:${SEVERITY_COLOR[sev]}">${sev}</b></p>`, cta: link ? { label: "Open in MagicWand", url: link } : undefined }) });
      if (!r.sent) throw new Error(r.error ?? "Email not sent");
      return;
    }
    case "webhook": {
      const url = String(cfg.url ?? "");
      if (!/^https?:\/\//i.test(url)) throw new Error("Webhook URL is not configured");
      const payload = { event: n.kind ?? "notification", title: n.title, body: n.body ?? null, severity: sev, link: link ?? null, device: n.deviceName ?? null, alertId: n.alertId ?? null, resolved: !!n.resolve, orgId, channel: { id: ch.id, name: ch.name }, data: n.data ?? {}, ts: new Date().toISOString() };
      const raw = JSON.stringify(payload);
      const headers: Record<string, string> = {};
      for (const line of (Array.isArray(cfg.headers) ? (cfg.headers as string[]) : String(cfg.headers ?? "").split("\n"))) {
        const i = line.indexOf(":");
        if (i > 0) headers[line.slice(0, i).trim()] = line.slice(i + 1).trim();
      }
      if (cfg.secret) headers["X-MagicWand-Signature"] = `sha256=${hmacSha256(String(cfg.secret), raw)}`;
      headers["X-MagicWand-Event"] = payload.event;
      const method = String(cfg.method ?? "POST").toUpperCase() === "PUT" ? "PUT" : "POST";
      ensureOk(await postJson(url, payload, headers, method));
      return;
    }
    case "slack": {
      const blocks = [
        { type: "header", text: { type: "plain_text", text: title.slice(0, 150), emoji: true } },
        { type: "section", text: { type: "mrkdwn", text: `${n.body ? n.body.slice(0, 2800) : "_No details_"}` }, ...(n.deviceName || sev ? { fields: [{ type: "mrkdwn", text: `*Severity*\n${sev}` }, ...(n.deviceName ? [{ type: "mrkdwn", text: `*Device*\n${n.deviceName}` }] : [])] } : {}) },
        ...(link ? [{ type: "actions", elements: [{ type: "button", text: { type: "plain_text", text: "Open in MagicWand" }, url: link }] }] : []),
      ];
      ensureOk(await postJson(String(cfg.webhookUrl), { text: `${title}${n.deviceName ? ` · ${n.deviceName}` : ""}`, ...(cfg.channel ? { channel: cfg.channel } : {}), blocks }));
      return;
    }
    case "teams": {
      const card = { type: "message", attachments: [{ contentType: "application/vnd.microsoft.card.adaptive", content: { $schema: "http://adaptivecards.io/schemas/adaptive-card.json", type: "AdaptiveCard", version: "1.4", msteams: { width: "Full" }, body: [
        { type: "TextBlock", size: "Large", weight: "Bolder", text: title, wrap: true, color: n.resolve ? "Good" : sev === "critical" || sev === "high" ? "Attention" : sev === "medium" ? "Warning" : "Default" },
        { type: "FactSet", facts: [{ title: "Severity", value: sev }, ...(n.deviceName ? [{ title: "Device", value: n.deviceName }] : [])] },
        ...(n.body ? [{ type: "TextBlock", text: n.body.slice(0, 3000), wrap: true }] : []),
      ], actions: link ? [{ type: "Action.OpenUrl", title: "Open in MagicWand", url: link }] : [] } }] };
      ensureOk(await postJson(String(cfg.webhookUrl), card));
      return;
    }
    case "discord": {
      ensureOk(await postJson(String(cfg.webhookUrl), { username: "MagicWand RMM", embeds: [{ title: title.slice(0, 256), description: (n.body ?? "").slice(0, 4000), url: link, color: Number.parseInt((n.resolve ? "#22c55e" : SEVERITY_COLOR[sev]).slice(1), 16), fields: [{ name: "Severity", value: sev, inline: true }, ...(n.deviceName ? [{ name: "Device", value: n.deviceName, inline: true }] : [])], timestamp: new Date().toISOString() }] }));
      return;
    }
    case "pagerduty": {
      const pdSeverity = sev === "critical" ? "critical" : sev === "high" ? "error" : sev === "medium" ? "warning" : "info";
      ensureOk(await postJson("https://events.pagerduty.com/v2/enqueue", { routing_key: String(cfg.routingKey), event_action: n.resolve ? "resolve" : "trigger", dedup_key: n.dedupKey ?? n.alertId ?? undefined, payload: { summary: `${n.title}${n.deviceName ? ` · ${n.deviceName}` : ""}`.slice(0, 1024), source: n.deviceName ?? "MagicWand RMM", severity: pdSeverity, custom_details: { body: n.body, ...(n.data ?? {}) } }, links: link ? [{ href: link, text: "Open in MagicWand" }] : [] }));
      return;
    }
    case "opsgenie": {
      const base = String(cfg.region ?? "us") === "eu" ? "https://api.eu.opsgenie.com" : "https://api.opsgenie.com";
      const headers = { authorization: `GenieKey ${String(cfg.apiKey)}` };
      if (n.resolve && (n.dedupKey || n.alertId)) { ensureOk(await postJson(`${base}/v2/alerts/${encodeURIComponent(n.dedupKey ?? n.alertId!)}/close?identifierType=alias`, { note: "Resolved by MagicWand RMM" }, headers)); return; }
      const priority = sev === "critical" ? "P1" : sev === "high" ? "P2" : sev === "medium" ? "P3" : sev === "low" ? "P4" : "P5";
      ensureOk(await postJson(`${base}/v2/alerts`, { message: `${n.title}${n.deviceName ? ` · ${n.deviceName}` : ""}`.slice(0, 130), alias: n.dedupKey ?? n.alertId ?? undefined, description: text.slice(0, 15000), priority, source: "MagicWand RMM", details: n.data ?? {} }, headers));
      return;
    }
    case "telegram": {
      const msg = `*${escapeMd(title)}*${n.deviceName ? `\n_${escapeMd(n.deviceName)}_` : ""}\n${escapeMd(n.body ?? "")}${link ? `\n[Open in MagicWand](${link})` : ""}`;
      ensureOk(await postJson(`https://api.telegram.org/bot${String(cfg.botToken)}/sendMessage`, { chat_id: String(cfg.chatId), text: msg.slice(0, 4000), parse_mode: "Markdown", disable_web_page_preview: true }));
      return;
    }
    case "pushover": {
      const r = await fetch("https://api.pushover.net/1/messages.json", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ token: String(cfg.appToken), user: String(cfg.userKey), title: title.slice(0, 250), message: text.slice(0, 1024), priority: sev === "critical" ? "1" : "0", ...(link ? { url: link, url_title: "Open in MagicWand" } : {}) }) });
      ensureOk({ status: r.status, text: await r.text().catch(() => "") });
      return;
    }
    case "ntfy": {
      const server = String(cfg.server || "https://ntfy.sh").replace(/\/$/, "");
      const headers: Record<string, string> = { Title: title.slice(0, 250), Priority: sev === "critical" ? "5" : sev === "high" ? "4" : sev === "medium" ? "3" : "2", Tags: n.resolve ? "white_check_mark" : sev === "critical" || sev === "high" ? "rotating_light" : "warning" };
      if (link) headers.Click = link;
      if (cfg.token) headers.Authorization = `Bearer ${String(cfg.token)}`;
      const r = await fetch(`${server}/${encodeURIComponent(String(cfg.topic))}`, { method: "POST", headers, body: text || title });
      ensureOk({ status: r.status, text: await r.text().catch(() => "") });
      return;
    }
    case "gotify": {
      const server = String(cfg.server ?? "").replace(/\/$/, "");
      ensureOk(await postJson(`${server}/message`, { title, message: text || title, priority: sev === "critical" ? 9 : sev === "high" ? 7 : sev === "medium" ? 5 : 3, extras: link ? { "client::notification": { click: { url: link } } } : undefined }, { "X-Gotify-Key": String(cfg.token) }));
      return;
    }
    case "in_app": {
      await notifyOrg(orgId, String(cfg.permission ?? "alerts.manage"), { title, body: [n.deviceName, n.body].filter(Boolean).join(" · ").slice(0, 500), link: n.link, severity: n.resolve ? "info" : sev });
      return;
    }
    default:
      throw new Error(`Channel type "${ch.type}" is not supported for delivery`);
  }
}

function escapeHtml(s: string) { return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string); }
function escapeMd(s: string) { return s.replace(/([_*`[\]])/g, "\\$1"); }

/** Send one notification through one channel, recording the attempt. Returns the notifications row. */
export async function sendToChannel(ch: NotificationChannel, n: Notification, opts: { force?: boolean; orgTimezone?: string } = {}) {
  const db = await getDb();
  const sev = n.severity ?? "info";
  const insert = async (status: "sent" | "failed" | "skipped", error?: string) => {
    const [row] = await db.insert(schema.notifications).values({ orgId: ch.orgId, channelId: ch.id, alertId: n.alertId ?? null, kind: n.kind ?? "alert", status, attempts: status === "skipped" ? 0 : 1, payload: { title: n.title, body: n.body ?? null, severity: sev, link: n.link ?? null, deviceName: n.deviceName ?? null, resolve: !!n.resolve }, error: error ?? null, sentAt: status === "sent" ? new Date() : null }).returning();
    return row;
  };
  if (!opts.force) {
    if (!ch.enabled) return insert("skipped", "channel disabled");
    if (SEVERITY_RANK[sev] < SEVERITY_RANK[ch.minSeverity] && !n.resolve) return insert("skipped", `below minimum severity (${ch.minSeverity})`);
    if (inQuietHours(ch.quietHours, new Date(), opts.orgTimezone ?? "UTC") && sev !== "critical") return insert("skipped", "quiet hours");
  }
  try {
    await deliver(ch, decryptedConfig(ch), n, ch.orgId);
    await db.update(schema.notificationChannels).set({ lastUsedAt: new Date(), lastError: null }).where(eq(schema.notificationChannels.id, ch.id));
    const row = await insert("sent");
    bus.publish("notification.sent", { id: row.id, channelId: ch.id, channel: ch.name, title: n.title }, { orgId: ch.orgId });
    return row;
  } catch (err) {
    const message = String((err as Error).message || err).slice(0, 500);
    log.warn("delivery failed", { channel: ch.name, type: ch.type, err: message });
    await db.update(schema.notificationChannels).set({ lastError: message }).where(eq(schema.notificationChannels.id, ch.id));
    const row = await insert("failed", message);
    bus.publish("notification.failed", { id: row.id, channelId: ch.id, channel: ch.name, error: message }, { orgId: ch.orgId });
    return row;
  }
}

/** Fan a notification out to several channels by id (unknown ids are ignored). */
export async function notifyChannels(orgId: string, channelIds: string[], n: Notification, opts: { force?: boolean } = {}) {
  if (!channelIds.length) return [];
  const db = await getDb();
  const channels = await db.select().from(schema.notificationChannels).where(and(eq(schema.notificationChannels.orgId, orgId), inArray(schema.notificationChannels.id, channelIds)));
  const tz = await orgTimezone(orgId);
  const out = [];
  for (const ch of channels) out.push(await sendToChannel(ch, n, { ...opts, orgTimezone: tz }));
  return out;
}

/** Channels flagged "receive all alerts" (config.isDefault) - used when a monitor names no channels. */
export async function defaultChannelIds(orgId: string): Promise<string[]> {
  const db = await getDb();
  const rows = await db.select({ id: schema.notificationChannels.id, config: schema.notificationChannels.config }).from(schema.notificationChannels).where(and(eq(schema.notificationChannels.orgId, orgId), eq(schema.notificationChannels.enabled, true)));
  return rows.filter((r) => r.config.isDefault === true).map((r) => r.id);
}

export async function orgTimezone(orgId: string): Promise<string> {
  const db = await getDb();
  const [org] = await db.select({ settings: schema.organizations.settings }).from(schema.organizations).where(eq(schema.organizations.id, orgId));
  const tz = org?.settings?.timezone;
  return tz && isValidTimezone(tz) ? tz : "UTC";
}

/** Recent delivery log for the org (optionally one channel). */
export async function listNotifications(orgId: string, opts: { channelId?: string; status?: string; page: number; pageSize: number }) {
  const db = await getDb();
  const where: SQL[] = [eq(schema.notifications.orgId, orgId)];
  if (opts.channelId) where.push(eq(schema.notifications.channelId, opts.channelId));
  if (opts.status) where.push(eq(schema.notifications.status, opts.status as "sent"));
  const [{ total }] = await db.select({ total: sql<number>`count(*)::int` }).from(schema.notifications).where(and(...where));
  const items = await db.select({ id: schema.notifications.id, channelId: schema.notifications.channelId, channelName: schema.notificationChannels.name, channelType: schema.notificationChannels.type, alertId: schema.notifications.alertId, kind: schema.notifications.kind, status: schema.notifications.status, attempts: schema.notifications.attempts, payload: schema.notifications.payload, error: schema.notifications.error, sentAt: schema.notifications.sentAt, createdAt: schema.notifications.createdAt })
    .from(schema.notifications).leftJoin(schema.notificationChannels, eq(schema.notificationChannels.id, schema.notifications.channelId)).where(and(...where)).orderBy(desc(schema.notifications.createdAt)).limit(opts.pageSize).offset((opts.page - 1) * opts.pageSize);
  return { items, total, page: opts.page, pageSize: opts.pageSize, pages: Math.max(1, Math.ceil(total / opts.pageSize)) };
}

/** Retry failed deliveries younger than a day (max 3 attempts). Called from the notifications module tick. */
export async function retryFailedNotifications(limit = 20) {
  const db = await getDb();
  const rows = await db.select().from(schema.notifications).where(and(eq(schema.notifications.status, "failed"), sql`${schema.notifications.attempts} < 3`, sql`${schema.notifications.createdAt} > now() - interval '1 day'`, sql`${schema.notifications.createdAt} < now() - interval '2 minutes'`)).orderBy(schema.notifications.createdAt).limit(limit);
  let retried = 0;
  for (const r of rows) {
    if (!r.channelId) continue;
    const [ch] = await db.select().from(schema.notificationChannels).where(eq(schema.notificationChannels.id, r.channelId));
    if (!ch || !ch.enabled) continue;
    const p = r.payload as { title: string; body: string | null; severity: Severity; link: string | null; deviceName: string | null; resolve: boolean };
    try {
      await deliver(ch, decryptedConfig(ch), { title: p.title, body: p.body ?? undefined, severity: p.severity, link: p.link ?? undefined, deviceName: p.deviceName, resolve: p.resolve, alertId: r.alertId, kind: r.kind }, ch.orgId);
      await db.update(schema.notifications).set({ status: "sent", sentAt: new Date(), attempts: r.attempts + 1, error: null }).where(eq(schema.notifications.id, r.id));
      await db.update(schema.notificationChannels).set({ lastUsedAt: new Date(), lastError: null }).where(eq(schema.notificationChannels.id, ch.id));
    } catch (err) {
      await db.update(schema.notifications).set({ attempts: r.attempts + 1, error: String((err as Error).message || err).slice(0, 500) }).where(eq(schema.notifications.id, r.id));
    }
    retried++;
  }
  return retried;
}
