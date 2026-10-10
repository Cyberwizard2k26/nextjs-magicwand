/**
 * Escalation policies: ordered steps "after N minutes without acknowledgement notify these channels / users".
 * Monitors reference a policy; the notifications module calls processEscalations() every minute.
 * Loaded at boot: no Next imports.
 */
import { and, desc, eq, inArray, isNull, lt, or, sql, type SQL } from "drizzle-orm";
import { getDb, schema } from "../db";
import { bus } from "../bus";
import { createLogger } from "../logger";
import { notifyChannels, type Notification } from "./notification-channels";
import { notifyUsers } from "./inbox";

const log = createLogger("escalation");

export type EscalationPolicy = typeof schema.escalationPolicies.$inferSelect;
export type EscalationStep = { afterMinutes: number; channelIds: string[]; userIds?: string[]; repeat?: boolean };

export interface EscalationInput { name: string; description?: string | null; steps: EscalationStep[]; repeatCount?: number }

export async function listEscalationPolicies(orgId: string, q?: string) {
  const db = await getDb();
  const where: SQL[] = [eq(schema.escalationPolicies.orgId, orgId)];
  if (q) where.push(sql`${schema.escalationPolicies.name} ilike ${"%" + q.replace(/[%_]/g, "\\$&") + "%"}`);
  const rows = await db.select().from(schema.escalationPolicies).where(and(...where)).orderBy(schema.escalationPolicies.name);
  const usage = rows.length ? await db.select({ id: schema.monitors.escalationPolicyId, n: sql<number>`count(*)::int` }).from(schema.monitors).where(and(eq(schema.monitors.orgId, orgId), inArray(schema.monitors.escalationPolicyId, rows.map((r) => r.id)))).groupBy(schema.monitors.escalationPolicyId) : [];
  return rows.map((r) => ({ ...r, monitorCount: usage.find((u) => u.id === r.id)?.n ?? 0 }));
}

export async function getEscalationPolicy(id: string, orgId: string) {
  const db = await getDb();
  const [row] = await db.select().from(schema.escalationPolicies).where(and(eq(schema.escalationPolicies.id, id), eq(schema.escalationPolicies.orgId, orgId)));
  return row ?? null;
}

function normaliseSteps(steps: EscalationStep[]): EscalationStep[] {
  const sorted = [...steps].sort((a, b) => a.afterMinutes - b.afterMinutes);
  if (!sorted.length) throw new Error("At least one step is required");
  for (const s of sorted) if (!s.channelIds.length && !s.userIds?.length) throw new Error("Every step needs at least one channel or user");
  return sorted;
}

export async function createEscalationPolicy(orgId: string, input: EscalationInput) {
  const db = await getDb();
  const [row] = await db.insert(schema.escalationPolicies).values({ orgId, name: input.name, description: input.description ?? null, steps: normaliseSteps(input.steps), repeatCount: input.repeatCount ?? 0 }).returning();
  bus.publish("escalation_policy.created", { id: row.id, name: row.name }, { orgId });
  return row;
}

export async function updateEscalationPolicy(id: string, orgId: string, patch: Partial<EscalationInput>) {
  const db = await getDb();
  const [row] = await db.update(schema.escalationPolicies).set({
    ...(patch.name !== undefined ? { name: patch.name } : {}),
    ...(patch.description !== undefined ? { description: patch.description } : {}),
    ...(patch.steps !== undefined ? { steps: normaliseSteps(patch.steps) } : {}),
    ...(patch.repeatCount !== undefined ? { repeatCount: patch.repeatCount } : {}),
  }).where(and(eq(schema.escalationPolicies.id, id), eq(schema.escalationPolicies.orgId, orgId))).returning();
  if (row) bus.publish("escalation_policy.updated", { id, name: row.name }, { orgId });
  return row ?? null;
}

export async function deleteEscalationPolicy(id: string, orgId: string) {
  const db = await getDb();
  const rows = await db.delete(schema.escalationPolicies).where(and(eq(schema.escalationPolicies.id, id), eq(schema.escalationPolicies.orgId, orgId))).returning({ id: schema.escalationPolicies.id });
  if (rows.length) {
    await db.update(schema.monitors).set({ escalationPolicyId: null }).where(and(eq(schema.monitors.orgId, orgId), eq(schema.monitors.escalationPolicyId, id)));
    bus.publish("escalation_policy.deleted", { id }, { orgId });
  }
  return rows.length > 0;
}

/**
 * Which step index applies to an alert that has been open for `elapsedMinutes` and already reached `level`
 * (number of steps already fired). Returns null when nothing is due. Pure, for tests and previews.
 */
export function dueStep(policy: Pick<EscalationPolicy, "steps" | "repeatCount">, level: number, elapsedMinutes: number): { index: number; step: EscalationStep } | null {
  const steps = policy.steps;
  if (!steps.length) return null;
  if (level < steps.length) {
    const s = steps[level];
    return elapsedMinutes >= s.afterMinutes ? { index: level, step: s } : null;
  }
  // Beyond the last step: repeat the last step every `afterMinutes` gap (min 15 min) up to repeatCount times.
  const last = steps[steps.length - 1];
  if (!last.repeat && !(policy.repeatCount > 0)) return null;
  const repeats = level - steps.length;
  const maxRepeats = policy.repeatCount > 0 ? policy.repeatCount : last.repeat ? 1000 : 0;
  if (repeats >= maxRepeats) return null;
  const gap = Math.max(15, steps.length > 1 ? last.afterMinutes - steps[steps.length - 2].afterMinutes : last.afterMinutes || 15);
  return elapsedMinutes >= last.afterMinutes + gap * (repeats + 1) ? { index: level, step: last } : null;
}

/** Fire escalation steps for open, unacknowledged alerts whose monitor has a policy. Returns escalations sent. */
export async function processEscalations(now = new Date()): Promise<number> {
  const db = await getDb();
  const rows = await db
    .select({ alert: schema.alerts, policyId: schema.monitors.escalationPolicyId, monitorName: schema.monitors.name, deviceName: schema.devices.name })
    .from(schema.alerts)
    .innerJoin(schema.monitors, eq(schema.monitors.id, schema.alerts.monitorId))
    .leftJoin(schema.devices, eq(schema.devices.id, schema.alerts.deviceId))
    .where(and(eq(schema.alerts.status, "open"), sql`${schema.monitors.escalationPolicyId} is not null`, or(isNull(schema.alerts.lastNotifiedAt), lt(schema.alerts.lastNotifiedAt, new Date(now.getTime() - 60_000)))))
    .orderBy(desc(schema.alerts.openedAt))
    .limit(500);
  if (!rows.length) return 0;
  const policyIds = [...new Set(rows.map((r) => r.policyId!).filter(Boolean))];
  const policies = await db.select().from(schema.escalationPolicies).where(inArray(schema.escalationPolicies.id, policyIds));
  let fired = 0;
  for (const r of rows) {
    const policy = policies.find((p) => p.id === r.policyId);
    if (!policy) continue;
    const elapsed = (now.getTime() - r.alert.openedAt.getTime()) / 60_000;
    const due = dueStep(policy, r.alert.escalationLevel, elapsed);
    if (!due) continue;
    const n: Notification = { title: `Escalation ${due.index + 1}: ${r.alert.title}`, body: `${r.alert.message ?? ""}\nOpen for ${Math.round(elapsed)} min without acknowledgement.`.trim(), severity: r.alert.severity, link: `/alerts/${r.alert.id}`, kind: "escalation", alertId: r.alert.id, deviceName: r.deviceName, dedupKey: r.alert.fingerprint, data: { escalationLevel: due.index + 1, policy: policy.name, monitor: r.monitorName } };
    try {
      if (due.step.channelIds.length) await notifyChannels(r.alert.orgId, due.step.channelIds, n);
      if (due.step.userIds?.length) await notifyUsers(due.step.userIds, { orgId: r.alert.orgId, title: n.title, body: n.body, link: n.link, severity: r.alert.severity });
      await db.update(schema.alerts).set({ escalationLevel: due.index + 1, lastNotifiedAt: now }).where(eq(schema.alerts.id, r.alert.id));
      bus.publish("alert.escalated", { id: r.alert.id, title: r.alert.title, level: due.index + 1, policy: policy.name }, { orgId: r.alert.orgId, deviceId: r.alert.deviceId });
      fired++;
    } catch (err) {
      log.error("escalation failed", { alertId: r.alert.id, err: String(err) });
    }
  }
  return fired;
}
