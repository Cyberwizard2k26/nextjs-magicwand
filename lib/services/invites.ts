/**
 * Invitations: create (token hashed, emailed when SMTP is configured), list, revoke, public lookup and acceptance.
 * The invite row has no scope columns, so site/group scope + message live in the settings table under `invite:<id>`.
 */
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { getDb, schema } from "../db";
import { bus } from "../bus";
import { hashPassword, hashToken, randomToken, verifyPassword } from "../util/crypto";
import { emailLayout, sendMail } from "./email";
import { getSetting, setSetting } from "./settings";
import { auditLog } from "./audit";
import type { InviteAcceptT, InviteCreateT } from "../api/contracts/invites";
import { ServiceError } from "./org";

interface InviteScope { siteIds: string[]; groupIds: string[]; message?: string }
const scopeKey = (id: string) => `invite:${id}`;

async function loadScope(id: string): Promise<InviteScope> {
  return getSetting<InviteScope>(scopeKey(id), { siteIds: [], groupIds: [] });
}
async function deleteScope(id: string) {
  const db = await getDb();
  await db.delete(schema.settings).where(eq(schema.settings.key, scopeKey(id)));
}

export type InviteStatus = "pending" | "accepted" | "expired";
export function inviteStatus(i: { acceptedAt: Date | null; expiresAt: Date }, now = new Date()): InviteStatus {
  if (i.acceptedAt) return "accepted";
  return i.expiresAt < now ? "expired" : "pending";
}

const selection = { invite: schema.invites, roleName: schema.roles.name, inviterName: schema.users.name };

async function shape(row: { invite: typeof schema.invites.$inferSelect; roleName: string | null; inviterName: string | null }) {
  const scope = await loadScope(row.invite.id);
  const { tokenHash: _t, ...rest } = row.invite;
  void _t;
  return { ...rest, roleName: row.roleName, inviterName: row.inviterName, siteIds: scope.siteIds, groupIds: scope.groupIds, status: inviteStatus(row.invite) };
}

export async function listInvites(orgId: string, status: "pending" | "accepted" | "expired" | "all" = "pending") {
  const db = await getDb();
  const where = [eq(schema.invites.orgId, orgId)];
  if (status === "pending") where.push(isNull(schema.invites.acceptedAt), sql`${schema.invites.expiresAt} > now()`);
  if (status === "accepted") where.push(sql`${schema.invites.acceptedAt} is not null`);
  if (status === "expired") where.push(isNull(schema.invites.acceptedAt), sql`${schema.invites.expiresAt} <= now()`);
  const rows = await db.select(selection).from(schema.invites).leftJoin(schema.roles, eq(schema.roles.id, schema.invites.roleId)).leftJoin(schema.users, eq(schema.users.id, schema.invites.invitedBy)).where(and(...where)).orderBy(desc(schema.invites.createdAt)).limit(500);
  return Promise.all(rows.map(shape));
}

export async function getInvite(orgId: string, id: string) {
  const db = await getDb();
  const [row] = await db.select(selection).from(schema.invites).leftJoin(schema.roles, eq(schema.roles.id, schema.invites.roleId)).leftJoin(schema.users, eq(schema.users.id, schema.invites.invitedBy)).where(and(eq(schema.invites.orgId, orgId), eq(schema.invites.id, id)));
  return row ? shape(row) : null;
}

export async function createInvite(orgId: string, input: InviteCreateT, inviter: { id: string | null; name: string | null }, baseUrl: string) {
  const db = await getDb();
  const email = input.email.toLowerCase().trim();
  const [org] = await db.select().from(schema.organizations).where(eq(schema.organizations.id, orgId));
  if (!org) throw new ServiceError(404, "Organization not found", "not_found");
  const [role] = await db.select().from(schema.roles).where(and(eq(schema.roles.id, input.roleId), sql`(${schema.roles.orgId} is null or ${schema.roles.orgId} = ${orgId})`));
  if (!role) throw new ServiceError(400, "Role not found in this organization", "bad_request");
  const [existing] = await db.select({ userId: schema.memberships.userId }).from(schema.memberships).innerJoin(schema.users, eq(schema.users.id, schema.memberships.userId)).where(and(eq(schema.memberships.orgId, orgId), eq(schema.users.email, email)));
  if (existing) throw new ServiceError(409, `${email} is already a member of this organization`, "already_member");
  if (input.siteIds.length) {
    const sites = await db.select({ id: schema.sites.id }).from(schema.sites).where(and(eq(schema.sites.orgId, orgId), sql`${schema.sites.id} in ${input.siteIds}`));
    if (sites.length !== new Set(input.siteIds).size) throw new ServiceError(400, "One or more site ids do not belong to this organization", "bad_request");
  }
  // Replace any outstanding invitation for the same address.
  const stale = await db.select({ id: schema.invites.id }).from(schema.invites).where(and(eq(schema.invites.orgId, orgId), eq(schema.invites.email, email), isNull(schema.invites.acceptedAt)));
  for (const s of stale) { await db.delete(schema.invites).where(eq(schema.invites.id, s.id)); await deleteScope(s.id); }

  const token = randomToken(32);
  const expiresAt = new Date(Date.now() + input.expiresInDays * 86400_000);
  const [row] = await db.insert(schema.invites).values({ orgId, email, roleId: role.id, tokenHash: hashToken(token), invitedBy: inviter.id, expiresAt }).returning();
  await setSetting(scopeKey(row.id), { siteIds: [...new Set(input.siteIds)], groupIds: [...new Set(input.groupIds)], message: input.message } satisfies InviteScope);
  const inviteUrl = `${baseUrl.replace(/\/$/, "")}/invite/${token}`;
  const productName = org.branding?.productName || "MagicWand RMM";
  const mail = await sendMail({
    to: email,
    subject: `${inviter.name ? `${inviter.name} invited you` : "You're invited"} to ${org.name} on ${productName}`,
    text: `${inviter.name ?? "An administrator"} invited you to join ${org.name} as ${role.name}.\n\n${input.message ? input.message + "\n\n" : ""}Accept the invitation: ${inviteUrl}\n\nThis link expires ${expiresAt.toUTCString()}.`,
    html: emailLayout({ productName, title: `Join ${org.name}`, body: `<p>${inviter.name ?? "An administrator"} invited you to join <strong>${org.name}</strong> as <strong>${role.name}</strong>.</p>${input.message ? `<blockquote style="border-left:3px solid #7c6cff;margin:12px 0;padding:4px 12px;color:#e8ebf2">${input.message.replace(/</g, "&lt;")}</blockquote>` : ""}<p>The link expires on ${expiresAt.toUTCString()}.</p>`, cta: { label: "Accept invitation", url: inviteUrl } }),
  });
  bus.publish("invite.created", { id: row.id, email, roleName: role.name, emailSent: mail.sent }, { orgId });
  const invite = await getInvite(orgId, row.id);
  return { invite: invite!, emailSent: mail.sent, inviteUrl: mail.sent ? undefined : inviteUrl, emailError: mail.error };
}

/** Re-issue the token for a pending invite (new link, same scope). */
export async function resendInvite(orgId: string, id: string, inviter: { id: string | null; name: string | null }, baseUrl: string) {
  const current = await getInvite(orgId, id);
  if (!current) return null;
  if (current.status === "accepted") throw new ServiceError(409, "This invitation was already accepted", "conflict");
  const scope = await loadScope(id);
  await revokeInvite(orgId, id, { silent: true });
  return createInvite(orgId, { email: current.email, roleId: current.roleId, siteIds: scope.siteIds, groupIds: scope.groupIds, message: scope.message, expiresInDays: 7 }, inviter, baseUrl);
}

export async function revokeInvite(orgId: string, id: string, opts: { silent?: boolean } = {}) {
  const db = await getDb();
  const [row] = await db.delete(schema.invites).where(and(eq(schema.invites.orgId, orgId), eq(schema.invites.id, id))).returning();
  if (!row) return null;
  await deleteScope(id);
  if (!opts.silent) bus.publish("invite.revoked", { id, email: row.email }, { orgId });
  return row;
}

/* ---- Public flow ---- */

export async function lookupInvite(token: string) {
  const db = await getDb();
  const [row] = await db.select({ invite: schema.invites, orgName: schema.organizations.name, branding: schema.organizations.branding, roleName: schema.roles.name, inviterName: schema.users.name }).from(schema.invites).innerJoin(schema.organizations, eq(schema.organizations.id, schema.invites.orgId)).leftJoin(schema.roles, eq(schema.roles.id, schema.invites.roleId)).leftJoin(schema.users, eq(schema.users.id, schema.invites.invitedBy)).where(eq(schema.invites.tokenHash, hashToken(token)));
  if (!row) return { valid: false as const, reason: "not_found" as const };
  const status = inviteStatus(row.invite);
  if (status !== "pending") return { valid: false as const, reason: status };
  const [user] = await db.select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.email, row.invite.email));
  return { valid: true as const, email: row.invite.email, orgName: row.orgName, roleName: row.roleName ?? "Member", inviterName: row.inviterName, expiresAt: row.invite.expiresAt, existingUser: !!user, productName: row.branding?.productName || "MagicWand RMM" };
}

/** Accept an invitation: creates the user (new email) or verifies the existing user's password, then adds the membership. */
export async function acceptInvite(input: InviteAcceptT, meta: { ip: string }) {
  const db = await getDb();
  const [invite] = await db.select().from(schema.invites).where(eq(schema.invites.tokenHash, hashToken(input.token)));
  if (!invite) throw new ServiceError(404, "This invitation link is not valid", "not_found");
  const status = inviteStatus(invite);
  if (status === "accepted") throw new ServiceError(409, "This invitation was already used", "accepted");
  if (status === "expired") throw new ServiceError(410, "This invitation has expired. Ask your administrator for a new one.", "expired");
  const scope = await loadScope(invite.id);
  let [user] = await db.select().from(schema.users).where(eq(schema.users.email, invite.email));
  let created = false;
  if (user) {
    if (user.status !== "active") throw new ServiceError(409, "This account is disabled. Contact your administrator.", "disabled");
    if (!(await verifyPassword(input.password, user.passwordHash))) throw new ServiceError(401, "Incorrect password for the existing account", "invalid_credentials");
  } else {
    if (!input.name?.trim()) throw new ServiceError(400, "Your name is required", "bad_request");
    [user] = await db.insert(schema.users).values({ email: invite.email, name: input.name.trim(), passwordHash: await hashPassword(input.password), status: "active", lastLoginAt: new Date(), lastLoginIp: meta.ip }).returning();
    created = true;
  }
  const [existingMembership] = await db.select({ id: schema.memberships.id }).from(schema.memberships).where(and(eq(schema.memberships.userId, user.id), eq(schema.memberships.orgId, invite.orgId)));
  if (!existingMembership) {
    const others = await db.select({ id: schema.memberships.id }).from(schema.memberships).where(eq(schema.memberships.userId, user.id));
    await db.insert(schema.memberships).values({ userId: user.id, orgId: invite.orgId, roleId: invite.roleId, siteIds: scope.siteIds, groupIds: scope.groupIds, isDefault: others.length === 0 });
  }
  await db.update(schema.invites).set({ acceptedAt: new Date() }).where(eq(schema.invites.id, invite.id));
  await deleteScope(invite.id);
  await auditLog({ orgId: invite.orgId, actorType: "user", actorId: user.id, actorName: user.email, action: "invite.accepted", targetType: "user", targetId: user.id, targetName: user.email, details: { inviteId: invite.id, createdAccount: created, siteIds: scope.siteIds }, ip: meta.ip });
  bus.publish("invite.accepted", { id: invite.id, email: user.email, userId: user.id, createdAccount: created }, { orgId: invite.orgId, userId: user.id });
  return { user, orgId: invite.orgId, created };
}
