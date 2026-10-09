import { z } from "zod";
import { NextResponse } from "next/server";
import { api, errors } from "@/lib/api/route";
import { boot, createOrganization, hasAnyUser } from "@/lib/boot";
import { getDb, schema } from "@/lib/db";
import { hashPassword } from "@/lib/util/crypto";
import { createSession, sessionCookie } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

export const GET = api({ public: true }, async () => {
  await boot({ withServices: false });
  return { needsSetup: !(await hasAnyUser()) };
});

export const POST = api(
  { public: true, body: z.object({ orgName: z.string().min(1).max(120), name: z.string().min(1).max(120), email: z.string().email().max(254), password: z.string().min(12).max(256) }) },
  async ({ body, ip, req }) => {
    await boot({ withServices: false });
    if (await hasAnyUser()) throw errors.conflict("Setup has already been completed");
    const db = await getDb();
    const [user] = await db.insert(schema.users).values({ email: body.email.toLowerCase(), name: body.name, passwordHash: await hashPassword(body.password), isSuperAdmin: true, lastLoginAt: new Date(), lastLoginIp: ip }).returning();
    const org = await createOrganization({ name: body.orgName, kind: "msp", ownerUserId: user.id });
    const { token, maxAgeSeconds } = await createSession(user.id, { ip, userAgent: req.headers.get("user-agent") || "", mfaVerified: true, activeOrgId: org.id });
    await db.insert(schema.auditLogs).values({ orgId: org.id, actorType: "user", actorId: user.id, actorName: user.email, action: "setup.completed", ip, details: { orgName: org.name } });
    return NextResponse.json({ ok: true, orgId: org.id }, { headers: { "set-cookie": sessionCookie(token, maxAgeSeconds) } });
  },
);
