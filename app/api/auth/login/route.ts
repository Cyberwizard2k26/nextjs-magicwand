import { z } from "zod";
import { NextResponse } from "next/server";
import { eq, sql } from "drizzle-orm";
import { api, errors } from "@/lib/api/route";
import { boot } from "@/lib/boot";
import { getDb, schema } from "@/lib/db";
import { verifyPassword } from "@/lib/util/crypto";
import { createSession, sessionCookie } from "@/lib/auth/session";
import { rateLimit } from "@/lib/util/rate-limit";

export const dynamic = "force-dynamic";

export const POST = api({ public: true, body: z.object({ email: z.string().email(), password: z.string().min(1).max(256) }) }, async ({ body, ip, req }) => {
  await boot({ withServices: false });
  const email = body.email.toLowerCase();
  if (!rateLimit(`login:${ip}`, 20, 15 * 60_000) || !rateLimit(`login:${email}`, 10, 15 * 60_000)) throw errors.tooMany("Too many sign-in attempts. Try again later.");
  const db = await getDb();
  const [user] = await db.select().from(schema.users).where(eq(schema.users.email, email));
  const generic = () => new Response(JSON.stringify({ error: "invalid_credentials", message: "Invalid email or password" }), { status: 401, headers: { "content-type": "application/json" } });
  if (!user || !user.passwordHash) return generic();
  if (user.lockedUntil && user.lockedUntil > new Date()) throw new Response(JSON.stringify({ error: "locked", message: "Account temporarily locked. Try again later." }), { status: 423 });
  if (user.status !== "active") return generic();
  if (!(await verifyPassword(body.password, user.passwordHash))) {
    const failed = user.failedLoginCount + 1;
    await db.update(schema.users).set({ failedLoginCount: failed, lockedUntil: failed >= 8 ? new Date(Date.now() + 15 * 60_000) : null }).where(eq(schema.users.id, user.id));
    await db.insert(schema.auditLogs).values({ actorType: "user", actorId: user.id, actorName: user.email, action: "auth.login_failed", ip, details: { reason: "bad_password" } });
    return generic();
  }
  await db.update(schema.users).set({ failedLoginCount: 0, lockedUntil: null, lastLoginAt: new Date(), lastLoginIp: ip }).where(eq(schema.users.id, user.id));
  const [membership] = await db.select({ orgId: schema.memberships.orgId }).from(schema.memberships).where(eq(schema.memberships.userId, user.id)).orderBy(sql`${schema.memberships.isDefault} desc`).limit(1);
  const { token, maxAgeSeconds } = await createSession(user.id, { ip, userAgent: req.headers.get("user-agent") || "", mfaVerified: !user.totpEnabled, activeOrgId: membership?.orgId ?? null });
  await db.insert(schema.auditLogs).values({ orgId: membership?.orgId ?? null, actorType: "user", actorId: user.id, actorName: user.email, action: "auth.login", ip, userAgent: (req.headers.get("user-agent") || "").slice(0, 512), details: { mfaRequired: user.totpEnabled } });
  return NextResponse.json({ ok: true, mfaRequired: user.totpEnabled }, { headers: { "set-cookie": sessionCookie(token, maxAgeSeconds) } });
});
