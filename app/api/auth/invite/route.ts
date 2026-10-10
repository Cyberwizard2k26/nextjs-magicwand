import { NextResponse } from "next/server";
import { api, ApiError } from "@/lib/api/route";
import { boot } from "@/lib/boot";
import { InviteAccept, InviteLookupQuery } from "@/lib/api/contracts/invites";
import { acceptInvite, lookupInvite } from "@/lib/services/invites";
import { ServiceError } from "@/lib/services/org";
import { createSession, sessionCookie } from "@/lib/auth/session";
import { rateLimit } from "@/lib/util/rate-limit";

export const dynamic = "force-dynamic";

/** Public: describe an invitation (who invited you, to which organization and role) without revealing anything else. */
export const GET = api({ public: true, query: InviteLookupQuery }, async ({ query, ip }) => {
  await boot({ withServices: false });
  if (!rateLimit(`invite-lookup:${ip}`, 60, 10 * 60_000)) throw new ApiError(429, "Too many requests", "rate_limited");
  return lookupInvite(query.token);
});

/** Public: accept an invitation. Creates the account for a new email (name + password) or verifies an existing user's password, then signs in. */
export const POST = api({ public: true, body: InviteAccept }, async ({ body, ip, req }) => {
  await boot({ withServices: false });
  if (!rateLimit(`invite-accept:${ip}`, 15, 15 * 60_000)) throw new ApiError(429, "Too many attempts. Try again later.", "rate_limited");
  const r = await acceptInvite(body, { ip }).catch((e: unknown) => { throw e instanceof ServiceError ? new ApiError(e.status, e.message, e.code) : e; });
  const { token, maxAgeSeconds } = await createSession(r.user.id, { ip, userAgent: req.headers.get("user-agent") || "", mfaVerified: !r.user.totpEnabled, activeOrgId: r.orgId });
  return NextResponse.json({ ok: true, createdAccount: r.created, mfaRequired: r.user.totpEnabled, orgId: r.orgId }, { headers: { "set-cookie": sessionCookie(token, maxAgeSeconds) } });
});
