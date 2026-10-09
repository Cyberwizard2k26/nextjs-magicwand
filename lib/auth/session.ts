/**
 * Cookie sessions + API keys. Resolves the current principal from a Request (App Router) or an IncomingMessage (ws upgrade).
 */
import { and, eq, gt, isNull } from "drizzle-orm";
import type { IncomingMessage } from "node:http";
import { getDb, schema } from "../db";
import { config } from "../config";
import { hashToken, randomToken } from "../util/crypto";
import { hasPermission, type Permission } from "../rbac/permissions";

export const SESSION_COOKIE = "mw_session";
export const MFA_COOKIE = "mw_mfa";

export interface Principal {
  kind: "user" | "apikey";
  user: typeof schema.users.$inferSelect | null;
  apiKey: typeof schema.apiKeys.$inferSelect | null;
  session: typeof schema.sessions.$inferSelect | null;
  /** Memberships with their resolved permission lists. */
  memberships: { orgId: string; roleId: string; roleName: string; permissions: string[]; siteIds: string[]; groupIds: string[] }[];
  isSuperAdmin: boolean;
  /** Organization the request is scoped to (from session, header, or the only membership). */
  activeOrgId: string | null;
  ip: string;
  userAgent: string;
}

export function parseCookies(header: string | null | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    const v = part.slice(i + 1).trim();
    if (k) out[k] = decodeURIComponent(v);
  }
  return out;
}

export function clientIp(headers: Headers | IncomingMessage["headers"], socketIp?: string): string {
  const get = (k: string) => (headers instanceof Headers ? headers.get(k) : (headers[k] as string | undefined)) || "";
  if (config.trustProxy) {
    const xf = get("x-forwarded-for");
    if (xf) return xf.split(",")[0].trim();
    const real = get("x-real-ip");
    if (real) return real;
  }
  return socketIp || "";
}

export function sessionCookie(token: string, maxAgeSeconds: number): string {
  const parts = [`${SESSION_COOKIE}=${encodeURIComponent(token)}`, "Path=/", "HttpOnly", "SameSite=Lax", `Max-Age=${maxAgeSeconds}`];
  if (config.secureCookies) parts.push("Secure");
  return parts.join("; ");
}
export function clearSessionCookie(): string {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${config.secureCookies ? "; Secure" : ""}`;
}

export async function createSession(userId: string, meta: { ip: string; userAgent: string; mfaVerified: boolean; activeOrgId?: string | null }) {
  const db = await getDb();
  const token = randomToken(32);
  const expiresAt = new Date(Date.now() + config.sessionTtlHours * 3600 * 1000);
  const [row] = await db
    .insert(schema.sessions)
    .values({ userId, tokenHash: hashToken(token), ip: meta.ip, userAgent: meta.userAgent.slice(0, 512), mfaVerified: meta.mfaVerified, activeOrgId: meta.activeOrgId ?? null, expiresAt, lastSeenAt: new Date() })
    .returning();
  return { token, session: row, maxAgeSeconds: config.sessionTtlHours * 3600 };
}

export async function destroySession(token: string) {
  const db = await getDb();
  await db.delete(schema.sessions).where(eq(schema.sessions.tokenHash, hashToken(token)));
}

async function loadMemberships(userId: string) {
  const db = await getDb();
  const rows = await db
    .select({ orgId: schema.memberships.orgId, roleId: schema.memberships.roleId, roleName: schema.roles.name, permissions: schema.roles.permissions, siteIds: schema.memberships.siteIds, groupIds: schema.memberships.groupIds, orgStatus: schema.organizations.status })
    .from(schema.memberships)
    .innerJoin(schema.roles, eq(schema.roles.id, schema.memberships.roleId))
    .innerJoin(schema.organizations, eq(schema.organizations.id, schema.memberships.orgId))
    .where(eq(schema.memberships.userId, userId));
  return rows.filter((r) => r.orgStatus === "active").map(({ orgStatus: _s, ...r }) => { void _s; return r; });
}

/** Resolve a principal from a raw session token (cookie) or API key (Authorization: Bearer mw_...). */
export async function resolvePrincipal(opts: { cookieHeader?: string | null; authorization?: string | null; orgHeader?: string | null; ip: string; userAgent: string; touch?: boolean }): Promise<Principal | null> {
  const db = await getDb();
  const auth = opts.authorization || "";
  if (auth.toLowerCase().startsWith("bearer ")) {
    const raw = auth.slice(7).trim();
    if (raw.startsWith("mw_")) {
      const [key] = await db.select().from(schema.apiKeys).where(and(eq(schema.apiKeys.keyHash, hashToken(raw)), isNull(schema.apiKeys.revokedAt)));
      if (!key) return null;
      if (key.expiresAt && key.expiresAt < new Date()) return null;
      if (key.allowedIps.length && !key.allowedIps.includes(opts.ip)) return null;
      if (opts.touch !== false) db.update(schema.apiKeys).set({ lastUsedAt: new Date() }).where(eq(schema.apiKeys.id, key.id)).catch(() => {});
      const user = key.userId ? (await db.select().from(schema.users).where(eq(schema.users.id, key.userId)))[0] ?? null : null;
      return {
        kind: "apikey",
        user,
        apiKey: key,
        session: null,
        memberships: [{ orgId: key.orgId, roleId: "apikey", roleName: "API key", permissions: key.permissions, siteIds: [], groupIds: [] }],
        isSuperAdmin: false,
        activeOrgId: key.orgId,
        ip: opts.ip,
        userAgent: opts.userAgent,
      };
    }
  }
  const cookies = parseCookies(opts.cookieHeader);
  const token = cookies[SESSION_COOKIE];
  if (!token) return null;
  const [session] = await db.select().from(schema.sessions).where(and(eq(schema.sessions.tokenHash, hashToken(token)), gt(schema.sessions.expiresAt, new Date())));
  if (!session) return null;
  const [user] = await db.select().from(schema.users).where(eq(schema.users.id, session.userId));
  if (!user || user.status !== "active") return null;
  if (opts.touch !== false && (!session.lastSeenAt || Date.now() - session.lastSeenAt.getTime() > 60_000)) {
    db.update(schema.sessions).set({ lastSeenAt: new Date() }).where(eq(schema.sessions.id, session.id)).catch(() => {});
  }
  const memberships = await loadMemberships(user.id);
  let activeOrgId = opts.orgHeader || session.activeOrgId || null;
  if (activeOrgId && !user.isSuperAdmin && !memberships.some((m) => m.orgId === activeOrgId)) activeOrgId = null;
  if (!activeOrgId) activeOrgId = memberships[0]?.orgId ?? null;
  return { kind: "user", user, apiKey: null, session, memberships, isSuperAdmin: user.isSuperAdmin, activeOrgId, ip: opts.ip, userAgent: opts.userAgent };
}

export function principalPermissions(p: Principal, orgId: string | null): string[] {
  if (p.isSuperAdmin) return ["*"];
  if (!orgId) return [];
  return p.memberships.find((m) => m.orgId === orgId)?.permissions ?? [];
}

export function can(p: Principal, permission: Permission | Permission[], orgId: string | null = p.activeOrgId): boolean {
  return hasPermission(principalPermissions(p, orgId), permission);
}

export function requiresMfa(p: Principal): boolean {
  if (p.kind !== "user" || !p.user || !p.session) return false;
  return p.user.totpEnabled && !p.session.mfaVerified;
}
