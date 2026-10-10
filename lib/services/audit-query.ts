/**
 * Audit log reads: filtered, paginated listing with facets and CSV export. Writes happen through ctx.audit()/auditLog().
 */
import { and, desc, eq, gte, ilike, lt, or, sql, type SQL } from "drizzle-orm";
import { getDb, schema } from "../db";
import type { AuditQueryT } from "../api/contracts/audit";
import { ServiceError } from "./org";

export type AuditRow = typeof schema.auditLogs.$inferSelect;

function parseDate(v: string | undefined, label: string): Date | undefined {
  if (!v) return undefined;
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) throw new ServiceError(400, `${label} is not a valid date`, "bad_request");
  return d;
}

function buildWhere(orgId: string, p: AuditQueryT): SQL {
  const where: SQL[] = [eq(schema.auditLogs.orgId, orgId)];
  if (p.actorId) where.push(eq(schema.auditLogs.actorId, p.actorId));
  if (p.actorType) where.push(eq(schema.auditLogs.actorType, p.actorType));
  if (p.action) where.push(sql`${schema.auditLogs.action} like ${p.action.replace(/[%_]/g, "\\$&") + "%"}`);
  if (p.targetType) where.push(eq(schema.auditLogs.targetType, p.targetType));
  if (p.targetId) where.push(eq(schema.auditLogs.targetId, p.targetId));
  const from = parseDate(p.from, "from");
  const to = parseDate(p.to, "to");
  if (from) where.push(gte(schema.auditLogs.createdAt, from));
  if (to) where.push(lt(schema.auditLogs.createdAt, to));
  if (p.q) {
    const like = `%${p.q.replace(/[%_]/g, "\\$&")}%`;
    where.push(or(ilike(schema.auditLogs.action, like), ilike(schema.auditLogs.actorName, like), ilike(schema.auditLogs.targetName, like), ilike(schema.auditLogs.ip, like), sql`${schema.auditLogs.details}::text ilike ${like}`)!);
  }
  return and(...where)!;
}

export async function listAudit(orgId: string, p: AuditQueryT) {
  const db = await getDb();
  const where = buildWhere(orgId, p);
  const [{ total }] = await db.select({ total: sql<number>`count(*)::int` }).from(schema.auditLogs).where(where);
  const items = await db.select().from(schema.auditLogs).where(where).orderBy(desc(schema.auditLogs.createdAt)).limit(p.pageSize).offset((p.page - 1) * p.pageSize);
  return { items, total, page: p.page, pageSize: p.pageSize, pages: Math.max(1, Math.ceil(total / p.pageSize)) };
}

/** Distinct actions, target types and actors (top 100 each) for filter dropdowns. */
export async function auditFacets(orgId: string) {
  const db = await getDb();
  const actions = await db.select({ action: schema.auditLogs.action, n: sql<number>`count(*)::int` }).from(schema.auditLogs).where(eq(schema.auditLogs.orgId, orgId)).groupBy(schema.auditLogs.action).orderBy(sql`count(*) desc`).limit(100);
  const targetTypes = await db.select({ targetType: schema.auditLogs.targetType, n: sql<number>`count(*)::int` }).from(schema.auditLogs).where(and(eq(schema.auditLogs.orgId, orgId), sql`${schema.auditLogs.targetType} is not null`)).groupBy(schema.auditLogs.targetType).orderBy(sql`count(*) desc`).limit(50);
  const actors = await db.select({ actorId: schema.auditLogs.actorId, actorName: sql<string | null>`max(${schema.auditLogs.actorName})`, n: sql<number>`count(*)::int` }).from(schema.auditLogs).where(and(eq(schema.auditLogs.orgId, orgId), sql`${schema.auditLogs.actorId} is not null`)).groupBy(schema.auditLogs.actorId).orderBy(sql`count(*) desc`).limit(100);
  return { actions, targetTypes: targetTypes.map((t) => ({ targetType: t.targetType!, n: t.n })), actors: actors.map((a) => ({ actorId: a.actorId!, actorName: a.actorName, n: a.n })) };
}

export async function getAuditEntry(orgId: string, id: string) {
  const db = await getDb();
  const [row] = await db.select().from(schema.auditLogs).where(and(eq(schema.auditLogs.orgId, orgId), eq(schema.auditLogs.id, id)));
  return row ?? null;
}

const csvCell = (v: unknown) => {
  const s = v === null || v === undefined ? "" : typeof v === "object" ? JSON.stringify(v) : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** CSV export of the filtered log (most recent first, capped at 50 000 rows). */
export async function exportAuditCsv(orgId: string, p: AuditQueryT): Promise<string> {
  const db = await getDb();
  const rows = await db.select().from(schema.auditLogs).where(buildWhere(orgId, p)).orderBy(desc(schema.auditLogs.createdAt)).limit(50_000);
  const header = ["time", "actor_type", "actor_id", "actor_name", "action", "target_type", "target_id", "target_name", "ip", "user_agent", "details"];
  const lines = [header.join(",")];
  for (const r of rows) lines.push([r.createdAt.toISOString(), r.actorType, r.actorId, r.actorName, r.action, r.targetType, r.targetId, r.targetName, r.ip, r.userAgent, r.details].map(csvCell).join(","));
  return lines.join("\r\n") + "\r\n";
}
