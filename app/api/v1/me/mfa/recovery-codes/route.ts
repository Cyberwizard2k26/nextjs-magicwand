import { api, ApiError, errors } from "@/lib/api/route";
import { MfaDisable } from "@/lib/api/contracts/account";
import { regenerateRecoveryCodes } from "@/lib/services/account";
import { ServiceError } from "@/lib/services/org";
import { rateLimit } from "@/lib/util/rate-limit";

export const dynamic = "force-dynamic";

/** Replace the recovery codes (password required); the new set is shown once. */
export const POST = api({ orgOptional: true, body: MfaDisable }, async ({ principal, body, audit }) => {
  if (!principal.user) throw errors.forbidden("API keys cannot change MFA");
  if (!rateLimit(`mfa-codes:${principal.user.id}`, 5, 15 * 60_000)) throw errors.tooMany();
  const r = await regenerateRecoveryCodes(principal.user.id, body.password).catch((e: unknown) => { throw e instanceof ServiceError ? new ApiError(e.status, e.message, e.code) : e; });
  if (!r) throw errors.notFound();
  await audit("me.recovery_codes_regenerated", { type: "user", id: principal.user.id, name: principal.user.email });
  return r;
});
