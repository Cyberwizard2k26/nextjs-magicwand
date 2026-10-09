/** Audit logging from non-request contexts (background workers, automations, agents). Route handlers use ctx.audit(). */
import { getDb, schema } from "../db";
import type { AuditActorType } from "../db/schema/tenancy";

export async function auditLog(entry: { orgId?: string | null; actorType: AuditActorType; actorId?: string | null; actorName?: string | null; action: string; targetType?: string; targetId?: string; targetName?: string; details?: Record<string, unknown>; ip?: string }) {
  const db = await getDb();
  await db.insert(schema.auditLogs).values({ orgId: entry.orgId ?? null, actorType: entry.actorType, actorId: entry.actorId ?? null, actorName: entry.actorName ?? null, action: entry.action, targetType: entry.targetType, targetId: entry.targetId, targetName: entry.targetName, ip: entry.ip, details: entry.details ?? {} });
}
