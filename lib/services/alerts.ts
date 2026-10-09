/**
 * Alert lifecycle: list, acknowledge, resolve, snooze, comment. Monitors open alerts; people close them.
 * Loaded at boot by the monitoring module, so it must not import Next.js-only helpers (lib/api/route).
 */
import { and, asc, desc, eq, ilike, inArray, or, sql, type SQL } from "drizzle-orm";
import { getDb, schema } from "../db";
import { bus } from "../bus";

export type Alert = typeof schema.alerts.$inferSelect;

export interface AlertListParams {
  orgId: string;
  status?: string[];
  severity?: string[];
  category?: string[];
  deviceId?: string;
  q?: string;
  siteIds?: string[];
  sort?: string;
  dir?: "asc" | "desc";
  page: number;
  pageSize: number;
}

const SEVERITY_RANK = sql`case ${schema.alerts.severity} when 'critical' then 0 when 'high' then 1 when 'medium' then 2 when 'low' then 3 else 4 end`;

export async function listAlerts(p: AlertListParams) {
  const db = await getDb();
  const where: SQL[] = [eq(schema.alerts.orgId, p.orgId)];
  if (p.status?.length) where.push(inArray(schema.alerts.status, p.status as Alert["status"][]));
  if (p.severity?.length) where.push(inArray(schema.alerts.severity, p.severity as Alert["severity"][]));
  if (p.category?.length) where.push(inArray(schema.alerts.category, p.category as Alert["category"][]));
  if (p.deviceId) where.push(eq(schema.alerts.deviceId, p.deviceId));
  if (p.siteIds?.length) where.push(inArray(schema.devices.siteId, p.siteIds));
  if (p.q) {
    const like = `%${p.q.replace(/[%_]/g, "\\$&")}%`;
    where.push(or(ilike(schema.alerts.title, like), ilike(schema.alerts.message, like), ilike(schema.devices.name, like))!);
  }
  const order = p.sort === "openedAt" ? [p.dir === "asc" ? asc(schema.alerts.openedAt) : desc(schema.alerts.openedAt)] : p.sort === "lastSeenAt" ? [desc(schema.alerts.lastSeenAt)] : [SEVERITY_RANK, desc(schema.alerts.openedAt)];
  const base = db.select({ total: sql<number>`count(*)::int` }).from(schema.alerts).leftJoin(schema.devices, eq(schema.devices.id, schema.alerts.deviceId)).where(and(...where));
  const [{ total }] = await base;
  const items = await db
    .select({
      id: schema.alerts.id, deviceId: schema.alerts.deviceId, severity: schema.alerts.severity, status: schema.alerts.status, title: schema.alerts.title, message: schema.alerts.message, category: schema.alerts.category, source: schema.alerts.source,
      occurrences: schema.alerts.occurrences, openedAt: schema.alerts.openedAt, lastSeenAt: schema.alerts.lastSeenAt, acknowledgedAt: schema.alerts.acknowledgedAt, acknowledgedBy: schema.alerts.acknowledgedBy, snoozedUntil: schema.alerts.snoozedUntil, resolvedAt: schema.alerts.resolvedAt, ticketId: schema.alerts.ticketId, monitorId: schema.alerts.monitorId,
      deviceName: schema.devices.name, devicePlatform: schema.devices.platform, deviceStatus: schema.devices.status,
    })
    .from(schema.alerts)
    .leftJoin(schema.devices, eq(schema.devices.id, schema.alerts.deviceId))
    .where(and(...where))
    .orderBy(...order)
    .limit(p.pageSize)
    .offset((p.page - 1) * p.pageSize);
  return { items, total, page: p.page, pageSize: p.pageSize, pages: Math.max(1, Math.ceil(total / p.pageSize)) };
}

export async function alertCounts(orgId: string) {
  const db = await getDb();
  const rows = await db.select({ status: schema.alerts.status, severity: schema.alerts.severity, n: sql<number>`count(*)::int` }).from(schema.alerts).where(eq(schema.alerts.orgId, orgId)).groupBy(schema.alerts.status, schema.alerts.severity);
  const byStatus: Record<string, number> = {};
  const openBySeverity: Record<string, number> = {};
  for (const r of rows) {
    byStatus[r.status] = (byStatus[r.status] ?? 0) + r.n;
    if (r.status === "open" || r.status === "acknowledged") openBySeverity[r.severity] = (openBySeverity[r.severity] ?? 0) + r.n;
  }
  return { byStatus, openBySeverity };
}

export async function getAlert(id: string, orgId: string) {
  const db = await getDb();
  const [alert] = await db.select().from(schema.alerts).where(and(eq(schema.alerts.id, id), eq(schema.alerts.orgId, orgId)));
  if (!alert) return null;
  const device = alert.deviceId ? (await db.select({ id: schema.devices.id, name: schema.devices.name, platform: schema.devices.platform, status: schema.devices.status, loggedInUser: schema.devices.loggedInUser, siteId: schema.devices.siteId }).from(schema.devices).where(eq(schema.devices.id, alert.deviceId)))[0] ?? null : null;
  const comments = await db.select().from(schema.alertComments).where(eq(schema.alertComments.alertId, alert.id)).orderBy(asc(schema.alertComments.createdAt));
  const monitor = alert.monitorId ? (await db.select({ id: schema.monitors.id, name: schema.monitors.name, type: schema.monitors.type, thresholds: schema.monitors.thresholds }).from(schema.monitors).where(eq(schema.monitors.id, alert.monitorId)))[0] ?? null : null;
  return { alert, device, comments, monitor };
}

type Actor = { id: string | null; name: string | null };

export async function acknowledgeAlerts(orgId: string, ids: string[], actor: Actor) {
  const db = await getDb();
  const rows = await db.update(schema.alerts).set({ status: "acknowledged", acknowledgedAt: new Date(), acknowledgedBy: actor.id }).where(and(eq(schema.alerts.orgId, orgId), inArray(schema.alerts.id, ids), inArray(schema.alerts.status, ["open", "snoozed"]))).returning();
  for (const a of rows) bus.publish("alert.acknowledged", { id: a.id, title: a.title, severity: a.severity, by: actor.name }, { orgId, deviceId: a.deviceId });
  return rows;
}

export async function resolveAlerts(orgId: string, ids: string[], actor: Actor, resolution?: string) {
  const db = await getDb();
  const rows = await db.update(schema.alerts).set({ status: "resolved", resolvedAt: new Date(), resolvedBy: actor.id, resolution: resolution ?? "Resolved manually" }).where(and(eq(schema.alerts.orgId, orgId), inArray(schema.alerts.id, ids), inArray(schema.alerts.status, ["open", "acknowledged", "snoozed"]))).returning();
  for (const a of rows) bus.publish("alert.resolved", { id: a.id, title: a.title, severity: a.severity, by: actor.name, manual: true }, { orgId, deviceId: a.deviceId });
  return rows;
}

export async function snoozeAlerts(orgId: string, ids: string[], until: Date, actor: Actor) {
  const db = await getDb();
  const rows = await db.update(schema.alerts).set({ status: "snoozed", snoozedUntil: until }).where(and(eq(schema.alerts.orgId, orgId), inArray(schema.alerts.id, ids), inArray(schema.alerts.status, ["open", "acknowledged"]))).returning();
  for (const a of rows) bus.publish("alert.snoozed", { id: a.id, title: a.title, until: until.toISOString(), by: actor.name }, { orgId, deviceId: a.deviceId });
  return rows;
}

export async function reopenAlerts(orgId: string, ids: string[]) {
  const db = await getDb();
  const rows = await db.update(schema.alerts).set({ status: "open", snoozedUntil: null, resolvedAt: null, resolvedBy: null, resolution: null }).where(and(eq(schema.alerts.orgId, orgId), inArray(schema.alerts.id, ids))).returning();
  for (const a of rows) bus.publish("alert.reopened", { id: a.id, title: a.title, severity: a.severity }, { orgId, deviceId: a.deviceId });
  return rows;
}

export async function commentAlert(orgId: string, id: string, actor: Actor, body: string) {
  const db = await getDb();
  if (!(await getAlert(id, orgId))) return null;
  const [row] = await db.insert(schema.alertComments).values({ alertId: id, authorId: actor.id, authorName: actor.name, body }).returning();
  bus.publish("alert.commented", { id, commentId: row.id, by: actor.name }, { orgId });
  return row;
}

/** Wake snoozed alerts whose snooze expired (called from the monitoring tick). */
export async function unsnoozeExpired() {
  const db = await getDb();
  const rows = await db.update(schema.alerts).set({ status: "open", snoozedUntil: null }).where(and(eq(schema.alerts.status, "snoozed"), sql`${schema.alerts.snoozedUntil} < now()`)).returning({ id: schema.alerts.id, orgId: schema.alerts.orgId, deviceId: schema.alerts.deviceId, title: schema.alerts.title, severity: schema.alerts.severity });
  for (const a of rows) bus.publish("alert.reopened", { id: a.id, title: a.title, severity: a.severity, reason: "snooze expired" }, { orgId: a.orgId, deviceId: a.deviceId });
  return rows.length;
}
