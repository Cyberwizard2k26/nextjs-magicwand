import { z } from "zod";
import { eq } from "drizzle-orm";
import { api, errors } from "@/lib/api/route";
import { getDb, schema } from "@/lib/db";
import { decryptSecret, sha256 } from "@/lib/util/crypto";
import { verifyTotp } from "@/lib/auth/totp";
import { rateLimit } from "@/lib/util/rate-limit";

export const dynamic = "force-dynamic";

/** Complete the second factor for the current session (TOTP or recovery code). */
export const POST = api({ orgOptional: true, allowPendingMfa: true, body: z.object({ code: z.string().min(6).max(16) }) }, async ({ principal, body, ip, audit }) => {
  if (!principal.user || !principal.session) throw errors.badRequest();
  if (!rateLimit(`mfa:${principal.user.id}`, 10, 10 * 60_000)) throw errors.tooMany();
  const db = await getDb();
  const code = body.code.replace(/\s|-/g, "").toUpperCase();
  let ok = false;
  if (principal.user.totpSecretEnc && /^\d{6}$/.test(code)) ok = verifyTotp(decryptSecret(principal.user.totpSecretEnc, "totp"), code);
  if (!ok && principal.user.recoveryCodesHash.length) {
    const h = sha256(code);
    const idx = principal.user.recoveryCodesHash.indexOf(h);
    if (idx >= 0) {
      ok = true;
      const remaining = principal.user.recoveryCodesHash.filter((_, i) => i !== idx);
      await db.update(schema.users).set({ recoveryCodesHash: remaining }).where(eq(schema.users.id, principal.user.id));
      await audit("auth.recovery_code_used", { type: "user", id: principal.user.id }, { remaining: remaining.length, ip });
    }
  }
  if (!ok) throw new (await import("@/lib/api/route")).ApiError(401, "Invalid code", "invalid_code");
  await db.update(schema.sessions).set({ mfaVerified: true }).where(eq(schema.sessions.id, principal.session.id));
  await audit("auth.mfa_verified", { type: "user", id: principal.user.id });
  return { ok: true };
});
