/** In-app notifications (bell icon) - delivered live through the client hub. */
import { eq, inArray } from "drizzle-orm";
import { getDb, schema } from "../db";
import { clientHub } from "../realtime/client-hub";
import type { Severity } from "../db/schema/monitoring";

export async function notifyUsers(userIds: string[], n: { orgId?: string | null; title: string; body?: string; link?: string; severity?: Severity }) {
  if (!userIds.length) return;
  const db = await getDb();
  const rows = await db.insert(schema.inboxNotifications).values(userIds.map((userId) => ({ userId, orgId: n.orgId ?? null, title: n.title, body: n.body, link: n.link, severity: n.severity ?? "info" }))).returning();
  for (const r of rows) clientHub.sendToUser(r.userId, "inbox.new", r);
}

/** Notify every member of an org holding a permission (e.g. alerts.manage). */
export async function notifyOrg(orgId: string, permission: string | null, n: { title: string; body?: string; link?: string; severity?: Severity }) {
  const db = await getDb();
  const members = await db
    .select({ userId: schema.memberships.userId, permissions: schema.roles.permissions })
    .from(schema.memberships)
    .innerJoin(schema.roles, eq(schema.roles.id, schema.memberships.roleId))
    .where(eq(schema.memberships.orgId, orgId));
  const admins = await db.select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.isSuperAdmin, true));
  const ids = new Set<string>(admins.map((a) => a.id));
  for (const m of members) {
    if (!permission || m.permissions.includes("*") || m.permissions.includes(permission) || m.permissions.includes(permission.split(".")[0] + ".*")) ids.add(m.userId);
  }
  await notifyUsers([...ids], { ...n, orgId });
}

export async function markRead(userId: string, ids: string[]) {
  const db = await getDb();
  await db.update(schema.inboxNotifications).set({ readAt: new Date() }).where(inArray(schema.inboxNotifications.id, ids));
  void userId;
}
