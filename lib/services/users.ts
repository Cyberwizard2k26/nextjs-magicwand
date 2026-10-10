/**
 * Organization members: list/inspect memberships with their user + role, change role/scope/status, remove and reset MFA.
 * Suspending a member disables the user account (sign-in is refused everywhere) and revokes their sessions.
 */
import { and, asc, desc, eq, ilike, inArray, or, sql, type SQL } from "drizzle-orm";
import { getDb, schema } from "../db";
import { bus } from "../bus";
import type { MemberPatchT, UserListQueryT } from "../api/contracts/users";
import { grantsUserAdmin, wouldRemoveLastAdmin } from "./roles";
import { ServiceError } from "./org";

export type MemberStatus = "active" | "suspended" | "invited" | "locked";

const userStatusToMember = (s: string): MemberStatus => (s === "disabled" ? "suspended" : s === "invited" ? "invited" : s === "locked" ? "locked" : "active");

const selection = {
  id: schema.users.id,
  membershipId: schema.memberships.id,
  email: schema.users.email,
  name: schema.users.name,
  avatarUrl: schema.users.avatarUrl,
  userStatus: schema.users.status,
  isSuperAdmin: schema.users.isSuperAdmin,
  totpEnabled: schema.users.totpEnabled,
  roleId: schema.memberships.roleId,
  roleName: schema.roles.name,
  roleIsSystem: schema.roles.isSystem,
  permissions: schema.roles.permissions,
  siteIds: schema.memberships.siteIds,
  groupIds: schema.memberships.groupIds,
  isDefault: schema.memberships.isDefault,
  lastLoginAt: schema.users.lastLoginAt,
  lastLoginIp: schema.users.lastLoginIp,
  joinedAt: schema.memberships.createdAt,
};

interface MemberRow { id: string; membershipId: string; email: string; name: string; avatarUrl: string | null; userStatus: "active" | "invited" | "disabled" | "locked"; isSuperAdmin: boolean; totpEnabled: boolean; roleId: string; roleName: string; roleIsSystem: boolean; permissions: string[]; siteIds: string[]; groupIds: string[]; isDefault: boolean; lastLoginAt: Date | null; lastLoginIp: string | null; joinedAt: Date }
function shape(r: MemberRow) {
  const { userStatus, ...rest } = r;
  return { ...rest, status: userStatusToMember(userStatus) };
}
export type Member = ReturnType<typeof shape>;

export async function listMembers(p: UserListQueryT & { orgId: string }) {
  const db = await getDb();
  const where: SQL[] = [eq(schema.memberships.orgId, p.orgId)];
  if (p.roleId) where.push(eq(schema.memberships.roleId, p.roleId));
  if (p.status) where.push(eq(schema.users.status, p.status === "suspended" ? "disabled" : p.status));
  if (p.siteId) where.push(sql`${schema.memberships.siteIds} @> ${JSON.stringify([p.siteId])}::jsonb`);
  if (p.q) {
    const like = `%${p.q.replace(/[%_]/g, "\\$&")}%`;
    where.push(or(ilike(schema.users.name, like), ilike(schema.users.email, like), ilike(schema.roles.name, like))!);
  }
  const sortCol = { name: schema.users.name, email: schema.users.email, role: schema.roles.name, lastLoginAt: schema.users.lastLoginAt, joinedAt: schema.memberships.createdAt, status: schema.users.status }[p.sort ?? ""] ?? schema.users.name;
  const order = p.dir === "desc" ? desc(sortCol) : asc(sortCol);
  const base = () => db.select(selection).from(schema.memberships).innerJoin(schema.users, eq(schema.users.id, schema.memberships.userId)).innerJoin(schema.roles, eq(schema.roles.id, schema.memberships.roleId));
  const [{ total }] = await db.select({ total: sql<number>`count(*)::int` }).from(schema.memberships).innerJoin(schema.users, eq(schema.users.id, schema.memberships.userId)).innerJoin(schema.roles, eq(schema.roles.id, schema.memberships.roleId)).where(and(...where));
  const rows = await base().where(and(...where)).orderBy(order, asc(schema.users.email)).limit(p.pageSize).offset((p.page - 1) * p.pageSize);
  const all = await db.select({ status: schema.users.status, permissions: schema.roles.permissions, totp: schema.users.totpEnabled }).from(schema.memberships).innerJoin(schema.users, eq(schema.users.id, schema.memberships.userId)).innerJoin(schema.roles, eq(schema.roles.id, schema.memberships.roleId)).where(eq(schema.memberships.orgId, p.orgId));
  const counts = { total: all.length, active: all.filter((m) => m.status === "active").length, suspended: all.filter((m) => m.status === "disabled").length, admins: all.filter((m) => m.status === "active" && grantsUserAdmin(m.permissions)).length, mfa: all.filter((m) => m.totp).length };
  return { items: rows.map(shape), total, page: p.page, pageSize: p.pageSize, pages: Math.max(1, Math.ceil(total / p.pageSize)), counts };
}

export async function getMember(orgId: string, userId: string): Promise<Member | null> {
  const db = await getDb();
  const [row] = await db.select(selection).from(schema.memberships).innerJoin(schema.users, eq(schema.users.id, schema.memberships.userId)).innerJoin(schema.roles, eq(schema.roles.id, schema.memberships.roleId)).where(and(eq(schema.memberships.orgId, orgId), eq(schema.memberships.userId, userId)));
  return row ? shape(row) : null;
}

/** User ids of active members whose role grants users.manage. */
export async function listOrgAdmins(orgId: string): Promise<string[]> {
  const db = await getDb();
  const rows = await db.select({ userId: schema.memberships.userId, permissions: schema.roles.permissions, status: schema.users.status }).from(schema.memberships).innerJoin(schema.roles, eq(schema.roles.id, schema.memberships.roleId)).innerJoin(schema.users, eq(schema.users.id, schema.memberships.userId)).where(eq(schema.memberships.orgId, orgId));
  return rows.filter((r) => r.status === "active" && grantsUserAdmin(r.permissions)).map((r) => r.userId);
}

async function assertSitesInOrg(orgId: string, siteIds: string[]) {
  if (!siteIds.length) return;
  const db = await getDb();
  const rows = await db.select({ id: schema.sites.id }).from(schema.sites).where(and(eq(schema.sites.orgId, orgId), inArray(schema.sites.id, siteIds)));
  const missing = siteIds.filter((id) => !rows.some((r) => r.id === id));
  if (missing.length) throw new ServiceError(400, `Unknown site id${missing.length > 1 ? "s" : ""}: ${missing.join(", ")}`, "bad_request");
}
async function assertGroupsInOrg(orgId: string, groupIds: string[]) {
  if (!groupIds.length) return;
  const db = await getDb();
  const rows = await db.select({ id: schema.deviceGroups.id }).from(schema.deviceGroups).where(and(eq(schema.deviceGroups.orgId, orgId), inArray(schema.deviceGroups.id, groupIds)));
  const missing = groupIds.filter((id) => !rows.some((r) => r.id === id));
  if (missing.length) throw new ServiceError(400, `Unknown group id${missing.length > 1 ? "s" : ""}: ${missing.join(", ")}`, "bad_request");
}

export async function updateMember(orgId: string, userId: string, patch: MemberPatchT, actor: { id: string | null }) {
  const db = await getDb();
  const member = await getMember(orgId, userId);
  if (!member) return null;
  let newPermissions = member.permissions;
  if (patch.roleId && patch.roleId !== member.roleId) {
    const [role] = await db.select().from(schema.roles).where(and(eq(schema.roles.id, patch.roleId), or(sql`${schema.roles.orgId} is null`, eq(schema.roles.orgId, orgId))));
    if (!role) throw new ServiceError(400, "Role not found in this organization", "bad_request");
    newPermissions = role.permissions;
  }
  if (patch.status === "suspended" && actor.id === userId) throw new ServiceError(409, "You cannot suspend your own account", "self_change");
  if (patch.roleId && patch.roleId !== member.roleId && actor.id === userId && grantsUserAdmin(member.permissions) && !grantsUserAdmin(newPermissions)) throw new ServiceError(409, "You cannot remove your own administrator role. Ask another administrator.", "self_change");
  const staysAdmin = grantsUserAdmin(newPermissions) && patch.status !== "suspended";
  if (wouldRemoveLastAdmin(await listOrgAdmins(orgId), userId, staysAdmin)) throw new ServiceError(409, "This is the organization's last administrator. Promote someone else first.", "last_admin");
  if (patch.siteIds) await assertSitesInOrg(orgId, patch.siteIds);
  if (patch.groupIds) await assertGroupsInOrg(orgId, patch.groupIds);

  const mPatch: Partial<typeof schema.memberships.$inferInsert> = {};
  if (patch.roleId) mPatch.roleId = patch.roleId;
  if (patch.siteIds) mPatch.siteIds = [...new Set(patch.siteIds)];
  if (patch.groupIds) mPatch.groupIds = [...new Set(patch.groupIds)];
  if (Object.keys(mPatch).length) await db.update(schema.memberships).set(mPatch).where(eq(schema.memberships.id, member.membershipId));
  const uPatch: Partial<typeof schema.users.$inferInsert> = {};
  if (patch.name) uPatch.name = patch.name.trim();
  if (patch.status === "suspended") uPatch.status = "disabled";
  if (patch.status === "active") { uPatch.status = "active"; uPatch.failedLoginCount = 0; uPatch.lockedUntil = null; }
  if (Object.keys(uPatch).length) await db.update(schema.users).set({ ...uPatch, updatedAt: new Date() }).where(eq(schema.users.id, userId));
  if (patch.status === "suspended") await db.delete(schema.sessions).where(eq(schema.sessions.userId, userId));

  const updated = (await getMember(orgId, userId))!;
  bus.publish("user.updated", { id: userId, email: updated.email, changed: Object.keys(patch), status: updated.status, roleName: updated.roleName }, { orgId, userId });
  return { before: member, after: updated };
}

export async function removeMember(orgId: string, userId: string, actor: { id: string | null }) {
  const db = await getDb();
  const member = await getMember(orgId, userId);
  if (!member) return null;
  if (actor.id === userId) throw new ServiceError(409, "You cannot remove yourself from the organization", "self_change");
  if (wouldRemoveLastAdmin(await listOrgAdmins(orgId), userId, false)) throw new ServiceError(409, "This is the organization's last administrator. Promote someone else first.", "last_admin");
  await db.delete(schema.memberships).where(eq(schema.memberships.id, member.membershipId));
  // Sessions pinned to this org must not keep using it.
  await db.update(schema.sessions).set({ activeOrgId: null }).where(and(eq(schema.sessions.userId, userId), eq(schema.sessions.activeOrgId, orgId)));
  bus.publish("user.removed", { id: userId, email: member.email }, { orgId, userId });
  return member;
}

export async function resetMemberMfa(orgId: string, userId: string) {
  const db = await getDb();
  const member = await getMember(orgId, userId);
  if (!member) return null;
  await db.update(schema.users).set({ totpEnabled: false, totpSecretEnc: null, recoveryCodesHash: [], updatedAt: new Date() }).where(eq(schema.users.id, userId));
  await db.delete(schema.sessions).where(eq(schema.sessions.userId, userId));
  bus.publish("user.mfa_reset", { id: userId, email: member.email }, { orgId, userId });
  return { ...member, totpEnabled: false };
}
