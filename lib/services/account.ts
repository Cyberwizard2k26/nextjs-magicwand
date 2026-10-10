/**
 * Self-service account: profile, password, active sessions and TOTP multi-factor authentication (setup, enable with a
 * verification code, recovery codes, disable with password). Uses the TOTP helpers in lib/auth/totp.ts.
 */
import { and, desc, eq, ne } from "drizzle-orm";
import QRCode from "qrcode";
import { getDb, schema } from "../db";
import { bus } from "../bus";
import { decryptSecret, encryptSecret, hashPassword, humanCode, sha256, verifyPassword } from "../util/crypto";
import { generateTotpSecret, totpUri, verifyTotp } from "../auth/totp";
import type { MePatchT } from "../api/contracts/account";
import { ServiceError } from "./org";

export async function getMe(userId: string, activeOrgId: string | null) {
  const db = await getDb();
  const [user] = await db.select().from(schema.users).where(eq(schema.users.id, userId));
  if (!user) return null;
  const memberships = await db.select({ orgId: schema.memberships.orgId, orgName: schema.organizations.name, roleName: schema.roles.name, siteIds: schema.memberships.siteIds, isDefault: schema.memberships.isDefault }).from(schema.memberships).innerJoin(schema.organizations, eq(schema.organizations.id, schema.memberships.orgId)).innerJoin(schema.roles, eq(schema.roles.id, schema.memberships.roleId)).where(eq(schema.memberships.userId, userId));
  const passkeys = await db.select({ id: schema.webauthnCredentials.id, name: schema.webauthnCredentials.name, createdAt: schema.webauthnCredentials.createdAt, lastUsedAt: schema.webauthnCredentials.lastUsedAt }).from(schema.webauthnCredentials).where(eq(schema.webauthnCredentials.userId, userId));
  return {
    id: user.id, email: user.email, name: user.name, phone: user.phone, timezone: user.timezone, avatarUrl: user.avatarUrl, isSuperAdmin: user.isSuperAdmin, status: user.status,
    totpEnabled: user.totpEnabled, recoveryCodesRemaining: user.recoveryCodesHash.length, passkeys, preferences: user.preferences, lastLoginAt: user.lastLoginAt, lastLoginIp: user.lastLoginIp, createdAt: user.createdAt,
    memberships, activeOrgId,
  };
}

export async function updateMe(userId: string, patch: MePatchT) {
  const db = await getDb();
  const [user] = await db.select().from(schema.users).where(eq(schema.users.id, userId));
  if (!user) return null;
  const set: Partial<typeof schema.users.$inferInsert> = { updatedAt: new Date() };
  if (patch.name !== undefined) set.name = patch.name.trim();
  if (patch.phone !== undefined) set.phone = patch.phone;
  if (patch.timezone !== undefined) set.timezone = patch.timezone;
  if (patch.avatarUrl !== undefined) set.avatarUrl = patch.avatarUrl;
  if (patch.preferences) set.preferences = { ...user.preferences, ...patch.preferences };
  await db.update(schema.users).set(set).where(eq(schema.users.id, userId));
  bus.publish("me.updated", { changed: Object.keys(patch) }, { userId });
  return (await getMe(userId, null))!;
}

export async function changePassword(userId: string, currentPassword: string, newPassword: string, keepSessionId: string | null) {
  const db = await getDb();
  const [user] = await db.select().from(schema.users).where(eq(schema.users.id, userId));
  if (!user) return null;
  if (user.passwordHash && !(await verifyPassword(currentPassword, user.passwordHash))) throw new ServiceError(401, "Current password is incorrect", "invalid_credentials");
  if (currentPassword === newPassword) throw new ServiceError(400, "Choose a password you have not used before", "bad_request");
  if (/^(.)\1+$/.test(newPassword) || /^(password|qwerty|letmein|changeme)/i.test(newPassword)) throw new ServiceError(400, "That password is too easy to guess", "bad_request");
  await db.update(schema.users).set({ passwordHash: await hashPassword(newPassword), updatedAt: new Date() }).where(eq(schema.users.id, userId));
  // Sign out every other device.
  const revoked = await db.delete(schema.sessions).where(and(eq(schema.sessions.userId, userId), keepSessionId ? ne(schema.sessions.id, keepSessionId) : undefined)).returning({ id: schema.sessions.id });
  bus.publish("me.password_changed", { revokedSessions: revoked.length }, { userId });
  return { revokedSessions: revoked.length };
}

/** Very small user-agent parser - enough to label a session ("Chrome on Windows"). */
export function describeUserAgent(ua: string | null | undefined): { browser: string; os: string } {
  const s = ua ?? "";
  const browser = /Edg\//.test(s) ? "Edge" : /OPR\//.test(s) ? "Opera" : /Chrome\//.test(s) ? "Chrome" : /Firefox\//.test(s) ? "Firefox" : /Safari\//.test(s) && /Version\//.test(s) ? "Safari" : /curl\//.test(s) ? "curl" : /PostmanRuntime/.test(s) ? "Postman" : /python-requests/.test(s) ? "Python" : /HeadlessChrome/.test(s) ? "Headless Chrome" : s ? "Browser" : "Unknown client";
  const os = /Windows NT/.test(s) ? "Windows" : /Android/.test(s) ? "Android" : /iPhone|iPad/.test(s) ? "iOS" : /Mac OS X/.test(s) ? "macOS" : /CrOS/.test(s) ? "ChromeOS" : /Linux/.test(s) ? "Linux" : "Unknown OS";
  return { browser, os };
}

export async function listSessions(userId: string, currentSessionId: string | null) {
  const db = await getDb();
  const rows = await db.select().from(schema.sessions).where(eq(schema.sessions.userId, userId)).orderBy(desc(schema.sessions.lastSeenAt), desc(schema.sessions.createdAt));
  const now = new Date();
  return rows.filter((s) => s.expiresAt > now).map((s) => {
    const { tokenHash: _t, ...rest } = s;
    void _t;
    return { ...rest, ...describeUserAgent(s.userAgent), current: s.id === currentSessionId };
  });
}

export async function revokeSession(userId: string, sessionId: string, currentSessionId: string | null) {
  if (sessionId === currentSessionId) throw new ServiceError(409, "Use Sign out to end the current session", "current_session");
  const db = await getDb();
  const [row] = await db.delete(schema.sessions).where(and(eq(schema.sessions.userId, userId), eq(schema.sessions.id, sessionId))).returning({ id: schema.sessions.id });
  if (row) bus.publish("me.session_revoked", { sessionId }, { userId });
  return row ?? null;
}

export async function revokeOtherSessions(userId: string, currentSessionId: string | null) {
  const db = await getDb();
  const rows = await db.delete(schema.sessions).where(and(eq(schema.sessions.userId, userId), currentSessionId ? ne(schema.sessions.id, currentSessionId) : undefined)).returning({ id: schema.sessions.id });
  bus.publish("me.session_revoked", { count: rows.length }, { userId });
  return rows.length;
}

/* ---- MFA ---- */

/** Generate a new TOTP secret (stored encrypted but not yet enabled) and return the provisioning URI + QR. */
export async function beginMfaSetup(userId: string, issuer: string) {
  const db = await getDb();
  const [user] = await db.select().from(schema.users).where(eq(schema.users.id, userId));
  if (!user) return null;
  if (user.totpEnabled) throw new ServiceError(409, "Two-factor authentication is already enabled. Disable it first to re-enrol.", "already_enabled");
  const secret = generateTotpSecret();
  await db.update(schema.users).set({ totpSecretEnc: encryptSecret(secret, "totp"), updatedAt: new Date() }).where(eq(schema.users.id, userId));
  const otpauthUrl = totpUri(secret, user.email, issuer);
  const qrDataUrl = await QRCode.toDataURL(otpauthUrl, { margin: 1, width: 240, color: { dark: "#e8ebf2", light: "#00000000" } });
  return { secret, otpauthUrl, qrDataUrl };
}

function newRecoveryCodes(n = 8) {
  const codes = Array.from({ length: n }, () => humanCode(2, 5));
  return { codes, hashes: codes.map((c) => sha256(c.replace(/\s|-/g, "").toUpperCase())) };
}

/** Verify the first code from the authenticator, switch MFA on and hand out recovery codes once. */
export async function enableMfa(userId: string, code: string, sessionId: string | null) {
  const db = await getDb();
  const [user] = await db.select().from(schema.users).where(eq(schema.users.id, userId));
  if (!user) return null;
  if (user.totpEnabled) throw new ServiceError(409, "Two-factor authentication is already enabled", "already_enabled");
  if (!user.totpSecretEnc) throw new ServiceError(409, "Start the setup first to get a QR code", "not_started");
  if (!verifyTotp(decryptSecret(user.totpSecretEnc, "totp"), code.replace(/\s/g, ""))) throw new ServiceError(400, "That code is not valid. Check the time on your phone and try again.", "invalid_code");
  const { codes, hashes } = newRecoveryCodes();
  await db.update(schema.users).set({ totpEnabled: true, recoveryCodesHash: hashes, updatedAt: new Date() }).where(eq(schema.users.id, userId));
  if (sessionId) await db.update(schema.sessions).set({ mfaVerified: true }).where(eq(schema.sessions.id, sessionId));
  // Other sessions must complete MFA before they continue.
  await db.update(schema.sessions).set({ mfaVerified: false }).where(and(eq(schema.sessions.userId, userId), sessionId ? ne(schema.sessions.id, sessionId) : undefined));
  bus.publish("me.mfa_enabled", {}, { userId });
  return { enabled: true as const, recoveryCodes: codes };
}

export async function regenerateRecoveryCodes(userId: string, password: string) {
  const db = await getDb();
  const [user] = await db.select().from(schema.users).where(eq(schema.users.id, userId));
  if (!user) return null;
  if (!user.totpEnabled) throw new ServiceError(409, "Two-factor authentication is not enabled", "not_enabled");
  if (!(await verifyPassword(password, user.passwordHash))) throw new ServiceError(401, "Password is incorrect", "invalid_credentials");
  const { codes, hashes } = newRecoveryCodes();
  await db.update(schema.users).set({ recoveryCodesHash: hashes, updatedAt: new Date() }).where(eq(schema.users.id, userId));
  return { recoveryCodes: codes };
}

export async function disableMfa(userId: string, password: string) {
  const db = await getDb();
  const [user] = await db.select().from(schema.users).where(eq(schema.users.id, userId));
  if (!user) return null;
  if (!(await verifyPassword(password, user.passwordHash))) throw new ServiceError(401, "Password is incorrect", "invalid_credentials");
  await db.update(schema.users).set({ totpEnabled: false, totpSecretEnc: null, recoveryCodesHash: [], updatedAt: new Date() }).where(eq(schema.users.id, userId));
  bus.publish("me.mfa_disabled", {}, { userId });
  return { enabled: false as const };
}
