/**
 * Outbound webhooks: CRUD (secret encrypted at rest), event matching, signed delivery with retries and the delivery log.
 * Loaded at boot by lib/modules/integrations, so this file must not import lib/api/route.
 */
import { and, asc, desc, eq, inArray, lte, sql, type SQL } from "drizzle-orm";
import { getDb, schema } from "../db";
import { bus, type BusEvent } from "../bus";
import { decryptSecret, encryptSecret, hmacSha256, randomToken } from "../util/crypto";
import { createLogger } from "../logger";
import type { WebhookCreateT, WebhookPatchT } from "../api/contracts/webhooks";
import { ServiceError } from "./org";

const log = createLogger("webhooks");

export type Webhook = typeof schema.webhooks.$inferSelect;
export type WebhookDelivery = typeof schema.webhookDeliveries.$inferSelect;

export const SIGNATURE_HEADER = "X-MagicWand-Signature";
export const MAX_ATTEMPTS = 6;
/** Backoff after attempt n (1-based): 1 min, 5 min, 30 min, 2 h, 12 h. */
const BACKOFF_MS = [60_000, 5 * 60_000, 30 * 60_000, 2 * 3600_000, 12 * 3600_000];
/** Consecutive failures after which a webhook is switched off automatically. */
export const AUTO_DISABLE_AFTER = 50;
const TIMEOUT_MS = 10_000;

/** Events the UI offers as subscription suggestions (any dotted name published on the bus is deliverable). */
export const WEBHOOK_EVENT_CATALOG: { group: string; events: string[] }[] = [
  { group: "Devices", events: ["device.enrolled", "device.online", "device.offline", "device.approved", "device.decommissioned", "device.group_added"] },
  { group: "Alerts", events: ["alert.opened", "alert.acknowledged", "alert.resolved", "alert.snoozed", "alert.reopened", "alert.commented"] },
  { group: "Jobs", events: ["job.created", "job.completed", "job.failed", "job.run.succeeded", "job.run.failed"] },
  { group: "Patching", events: ["patch.installed", "patch.failed", "patch.scan.completed"] },
  { group: "Remote", events: ["session.started", "session.ended"] },
  { group: "Tickets", events: ["ticket.created", "ticket.updated", "ticket.resolved"] },
  { group: "Administration", events: ["user.updated", "user.removed", "invite.created", "invite.accepted", "role.created", "role.updated", "role.deleted", "site.created", "site.updated", "site.deleted", "group.created", "group.updated", "group.deleted", "org.updated"] },
];

/** `*` matches everything; `alert.*` matches the prefix; otherwise exact match. Webhook's own events are never deliverable. */
export function eventMatches(subscriptions: readonly string[], name: string): boolean {
  if (name.startsWith("webhook.")) return false;
  for (const s of subscriptions) {
    if (s === "*") return true;
    if (s === name) return true;
    if (s.endsWith(".*") && (name === s.slice(0, -2) || name.startsWith(s.slice(0, -1)))) return true;
  }
  return false;
}

export function signPayload(secret: string, timestamp: string, body: string): string {
  return `t=${timestamp},v1=${hmacSha256(secret, `${timestamp}.${body}`)}`;
}

const strip = (w: Webhook) => {
  const { secretEnc, ...rest } = w;
  return { ...rest, hasSecret: !!secretEnc };
};
export type WebhookView = ReturnType<typeof strip>;

export async function listWebhooks(orgId: string) {
  const db = await getDb();
  const rows = await db.select().from(schema.webhooks).where(eq(schema.webhooks.orgId, orgId)).orderBy(asc(schema.webhooks.name));
  const ids = rows.map((r) => r.id);
  const stats = ids.length ? await db.select({ webhookId: schema.webhookDeliveries.webhookId, status: schema.webhookDeliveries.status, n: sql<number>`count(*)::int` }).from(schema.webhookDeliveries).where(and(inArray(schema.webhookDeliveries.webhookId, ids), sql`${schema.webhookDeliveries.createdAt} > now() - interval '7 days'`)).groupBy(schema.webhookDeliveries.webhookId, schema.webhookDeliveries.status) : [];
  return rows.map((w) => {
    const s = { delivered: 0, failed: 0, pending: 0 };
    for (const r of stats) if (r.webhookId === w.id) s[r.status] = r.n;
    return { ...strip(w), stats: s };
  });
}

export async function getWebhook(orgId: string, id: string) {
  const db = await getDb();
  const [row] = await db.select().from(schema.webhooks).where(and(eq(schema.webhooks.orgId, orgId), eq(schema.webhooks.id, id)));
  return row ? strip(row) : null;
}

function assertUrl(url: string) {
  let u: URL;
  try { u = new URL(url); } catch { throw new ServiceError(400, "Invalid URL", "bad_request"); }
  if (!/^https?:$/.test(u.protocol)) throw new ServiceError(400, "Webhook URLs must use http or https", "bad_request");
}

export async function createWebhook(orgId: string, input: WebhookCreateT, actor: { id: string | null }) {
  assertUrl(input.url);
  const db = await getDb();
  const secret = input.secret ?? `whsec_${randomToken(24)}`;
  const [row] = await db.insert(schema.webhooks).values({ orgId, name: input.name.trim(), url: input.url, events: [...new Set(input.events)], headers: input.headers, enabled: input.enabled, secretEnc: encryptSecret(secret, "webhooks"), createdBy: actor.id }).returning();
  invalidateCache();
  bus.publish("webhook.created", { id: row.id, name: row.name, events: row.events }, { orgId });
  return { webhook: strip(row), secret };
}

export async function updateWebhook(orgId: string, id: string, patch: WebhookPatchT) {
  const db = await getDb();
  const [w] = await db.select().from(schema.webhooks).where(and(eq(schema.webhooks.orgId, orgId), eq(schema.webhooks.id, id)));
  if (!w) return null;
  if (patch.url) assertUrl(patch.url);
  let secret: string | undefined;
  const set: Partial<typeof schema.webhooks.$inferInsert> = { updatedAt: new Date() };
  if (patch.name !== undefined) set.name = patch.name.trim();
  if (patch.url !== undefined) set.url = patch.url;
  if (patch.events !== undefined) set.events = [...new Set(patch.events)];
  if (patch.headers !== undefined) set.headers = patch.headers;
  if (patch.enabled !== undefined) { set.enabled = patch.enabled; if (patch.enabled) set.failureCount = 0; }
  if (patch.secret || patch.rotateSecret) { secret = patch.secret ?? `whsec_${randomToken(24)}`; set.secretEnc = encryptSecret(secret, "webhooks"); }
  const [row] = await db.update(schema.webhooks).set(set).where(eq(schema.webhooks.id, id)).returning();
  invalidateCache();
  bus.publish("webhook.updated", { id, name: row.name, changed: Object.keys(patch) }, { orgId });
  return { webhook: strip(row), secret };
}

export async function deleteWebhook(orgId: string, id: string) {
  const db = await getDb();
  const [row] = await db.delete(schema.webhooks).where(and(eq(schema.webhooks.orgId, orgId), eq(schema.webhooks.id, id))).returning();
  if (!row) return null;
  invalidateCache();
  bus.publish("webhook.deleted", { id, name: row.name }, { orgId });
  return strip(row);
}

export async function listDeliveries(orgId: string, webhookId: string, p: { page: number; pageSize: number; status?: string; event?: string; q?: string }) {
  const db = await getDb();
  const w = await getWebhook(orgId, webhookId);
  if (!w) return null;
  const where: SQL[] = [eq(schema.webhookDeliveries.webhookId, webhookId)];
  if (p.status) where.push(eq(schema.webhookDeliveries.status, p.status as WebhookDelivery["status"]));
  if (p.event) where.push(sql`${schema.webhookDeliveries.event} like ${p.event.replace(/\*$/, "") + "%"}`);
  if (p.q) where.push(sql`${schema.webhookDeliveries.payload}::text ilike ${"%" + p.q.replace(/[%_]/g, "\\$&") + "%"}`);
  const [{ total }] = await db.select({ total: sql<number>`count(*)::int` }).from(schema.webhookDeliveries).where(and(...where));
  const items = await db.select().from(schema.webhookDeliveries).where(and(...where)).orderBy(desc(schema.webhookDeliveries.createdAt)).limit(p.pageSize).offset((p.page - 1) * p.pageSize);
  return { items, total, page: p.page, pageSize: p.pageSize, pages: Math.max(1, Math.ceil(total / p.pageSize)) };
}

/* ---- Delivery engine ---- */

let cache: { at: number; rows: Webhook[] } | null = null;
function invalidateCache() { cache = null; }

async function enabledWebhooks(): Promise<Webhook[]> {
  if (cache && Date.now() - cache.at < 30_000) return cache.rows;
  const db = await getDb();
  const rows = await db.select().from(schema.webhooks).where(eq(schema.webhooks.enabled, true));
  cache = { at: Date.now(), rows };
  return rows;
}

export interface DeliveryResult { ok: boolean; status: number | null; body: string | null; error: string | null; durationMs: number }

/** POST one delivery to its webhook and record the outcome (retry schedule on failure). */
export async function attemptDelivery(delivery: WebhookDelivery, webhook: Webhook): Promise<DeliveryResult> {
  const db = await getDb();
  const started = Date.now();
  const body = JSON.stringify({ id: delivery.id, event: delivery.event, createdAt: delivery.createdAt.toISOString(), attempt: delivery.attempts + 1, data: delivery.payload });
  const ts = String(Math.floor(Date.now() / 1000));
  const headers: Record<string, string> = { "content-type": "application/json", "user-agent": "MagicWand-Webhooks/1.0", "x-magicwand-event": delivery.event, "x-magicwand-delivery": delivery.id, "x-magicwand-webhook": webhook.id, ...webhook.headers };
  if (webhook.secretEnc) {
    try { headers[SIGNATURE_HEADER] = signPayload(decryptSecret(webhook.secretEnc, "webhooks"), ts, body); } catch (err) { log.warn("could not decrypt webhook secret", { id: webhook.id, err: String(err) }); }
  }
  let res: DeliveryResult;
  try {
    const r = await fetch(webhook.url, { method: "POST", headers, body, signal: AbortSignal.timeout(TIMEOUT_MS), redirect: "manual" });
    const text = (await r.text().catch(() => "")).slice(0, 2000);
    res = { ok: r.status >= 200 && r.status < 300, status: r.status, body: text || null, error: r.ok ? null : `HTTP ${r.status}`, durationMs: Date.now() - started };
  } catch (err) {
    const e = err as Error;
    res = { ok: false, status: null, body: null, error: e?.name === "TimeoutError" ? `Timed out after ${TIMEOUT_MS / 1000}s` : String(e?.message || err), durationMs: Date.now() - started };
  }
  const attempts = delivery.attempts + 1;
  const now = new Date();
  if (res.ok) {
    await db.update(schema.webhookDeliveries).set({ status: "delivered", attempts, responseCode: res.status, responseBody: res.body, deliveredAt: now, nextRetryAt: null }).where(eq(schema.webhookDeliveries.id, delivery.id));
    await db.update(schema.webhooks).set({ failureCount: 0, lastDeliveryAt: now, lastStatus: res.status }).where(eq(schema.webhooks.id, webhook.id));
    bus.publish("webhook.delivered", { id: webhook.id, deliveryId: delivery.id, event: delivery.event, status: res.status, durationMs: res.durationMs }, { orgId: webhook.orgId });
  } else {
    const final = attempts >= MAX_ATTEMPTS || (res.status !== null && [400, 401, 403, 404, 410, 422].includes(res.status) && delivery.event === "webhook.test");
    const nextRetryAt = final ? null : new Date(Date.now() + (BACKOFF_MS[Math.min(attempts - 1, BACKOFF_MS.length - 1)] ?? BACKOFF_MS.at(-1)!));
    await db.update(schema.webhookDeliveries).set({ status: final ? "failed" : "pending", attempts, responseCode: res.status, responseBody: res.body ?? res.error, nextRetryAt }).where(eq(schema.webhookDeliveries.id, delivery.id));
    const failureCount = webhook.failureCount + 1;
    const disable = failureCount >= AUTO_DISABLE_AFTER;
    await db.update(schema.webhooks).set({ failureCount, lastDeliveryAt: now, lastStatus: res.status, ...(disable ? { enabled: false } : {}) }).where(eq(schema.webhooks.id, webhook.id));
    if (disable) { invalidateCache(); log.warn("webhook auto-disabled after consecutive failures", { id: webhook.id, failureCount }); bus.publish("webhook.disabled", { id: webhook.id, name: webhook.name, reason: `${failureCount} consecutive failures` }, { orgId: webhook.orgId }); }
    bus.publish("webhook.failed", { id: webhook.id, deliveryId: delivery.id, event: delivery.event, status: res.status, error: res.error, attempts, final, nextRetryAt: nextRetryAt?.toISOString() ?? null }, { orgId: webhook.orgId });
  }
  return res;
}

/** Bus hook: queue a delivery for every enabled webhook of the event's org that subscribes to it, then try to send. */
export async function enqueueEvent(ev: BusEvent): Promise<number> {
  if (!ev.orgId || ev.name.startsWith("webhook.") || ev.name.startsWith("client.") || ev.name.startsWith("session.frame")) return 0;
  const hooks = (await enabledWebhooks()).filter((w) => w.orgId === ev.orgId && eventMatches(w.events, ev.name));
  if (!hooks.length) return 0;
  const db = await getDb();
  const payload = { name: ev.name, orgId: ev.orgId, deviceId: ev.deviceId ?? null, userId: ev.userId ?? null, ts: ev.ts, payload: ev.payload } as Record<string, unknown>;
  const rows = await db.insert(schema.webhookDeliveries).values(hooks.map((w) => ({ webhookId: w.id, event: ev.name, payload, status: "pending" as const }))).returning();
  for (const d of rows) {
    const w = hooks.find((h) => h.id === d.webhookId)!;
    attemptDelivery(d, w).catch((err) => log.error("delivery failed unexpectedly", { id: d.id, err: String(err) }));
  }
  return rows.length;
}

/** Retry pending deliveries whose backoff elapsed (leader only). Returns how many were attempted. */
export async function processRetries(limit = 50): Promise<number> {
  const db = await getDb();
  const due = await db.select().from(schema.webhookDeliveries).where(and(eq(schema.webhookDeliveries.status, "pending"), sql`${schema.webhookDeliveries.nextRetryAt} is not null`, lte(schema.webhookDeliveries.nextRetryAt, new Date()))).orderBy(asc(schema.webhookDeliveries.nextRetryAt)).limit(limit);
  if (!due.length) return 0;
  const hooks = await db.select().from(schema.webhooks).where(inArray(schema.webhooks.id, [...new Set(due.map((d) => d.webhookId))]));
  let n = 0;
  for (const d of due) {
    const w = hooks.find((h) => h.id === d.webhookId);
    if (!w || !w.enabled) { await db.update(schema.webhookDeliveries).set({ status: "failed", nextRetryAt: null, responseBody: "webhook disabled" }).where(eq(schema.webhookDeliveries.id, d.id)); continue; }
    await attemptDelivery(d, w);
    n++;
  }
  return n;
}

/** Send a synthetic `webhook.test` event right now and return the response. */
export async function testWebhook(orgId: string, id: string, actor: { name: string | null }) {
  const db = await getDb();
  const [w] = await db.select().from(schema.webhooks).where(and(eq(schema.webhooks.orgId, orgId), eq(schema.webhooks.id, id)));
  if (!w) return null;
  const [d] = await db.insert(schema.webhookDeliveries).values({ webhookId: id, event: "webhook.test", payload: { name: "webhook.test", orgId, ts: new Date().toISOString(), payload: { message: "Test delivery from MagicWand RMM", triggeredBy: actor.name, webhookId: id, webhookName: w.name } }, status: "pending" }).returning();
  const res = await attemptDelivery({ ...d, attempts: MAX_ATTEMPTS - 1 }, w); // a test never retries
  return { ...res, deliveryId: d.id };
}

/** Redeliver one delivery immediately (manual retry from the UI). */
export async function redeliver(orgId: string, webhookId: string, deliveryId: string) {
  const db = await getDb();
  const [w] = await db.select().from(schema.webhooks).where(and(eq(schema.webhooks.orgId, orgId), eq(schema.webhooks.id, webhookId)));
  if (!w) return null;
  const [d] = await db.select().from(schema.webhookDeliveries).where(and(eq(schema.webhookDeliveries.id, deliveryId), eq(schema.webhookDeliveries.webhookId, webhookId)));
  if (!d) return null;
  return attemptDelivery({ ...d, attempts: Math.min(d.attempts, MAX_ATTEMPTS - 1) }, w);
}

export async function purgeOldDeliveries(days = 30) {
  const db = await getDb();
  const rows = await db.delete(schema.webhookDeliveries).where(sql`${schema.webhookDeliveries.createdAt} < now() - (${days} || ' days')::interval`).returning({ id: schema.webhookDeliveries.id });
  return rows.length;
}
