import { api, ApiError, errors } from "@/lib/api/route";
import { MfaDisable, MfaEnable } from "@/lib/api/contracts/account";
import { beginMfaSetup, disableMfa, enableMfa } from "@/lib/services/account";
import { ServiceError } from "@/lib/services/org";
import { getOrgRow } from "@/lib/services/org";
import { rateLimit } from "@/lib/util/rate-limit";

export const dynamic = "force-dynamic";

const run = <T>(p: Promise<T>) => p.catch((e: unknown) => { throw e instanceof ServiceError ? new ApiError(e.status, e.message, e.code) : e; });

/** Start authenticator enrolment: returns the secret, otpauth URL and a QR code. Nothing is enforced until PUT confirms a code. */
export const POST = api({ orgOptional: true }, async ({ principal, orgId }) => {
  if (!principal.user) throw errors.forbidden("API keys cannot enrol in MFA");
  const org = orgId ? await getOrgRow(orgId) : null;
  const r = await run(beginMfaSetup(principal.user.id, org?.branding?.productName || "MagicWand RMM"));
  if (!r) throw errors.notFound();
  return r;
});

/** Confirm the first authenticator code; turns MFA on and returns recovery codes once. */
export const PUT = api({ orgOptional: true, body: MfaEnable }, async ({ principal, body, audit }) => {
  if (!principal.user) throw errors.forbidden("API keys cannot enrol in MFA");
  if (!rateLimit(`mfa-enable:${principal.user.id}`, 10, 10 * 60_000)) throw errors.tooMany();
  const r = await run(enableMfa(principal.user.id, body.code, principal.session?.id ?? null));
  if (!r) throw errors.notFound();
  await audit("me.mfa_enabled", { type: "user", id: principal.user.id, name: principal.user.email });
  return r;
});

/** Turn MFA off (password required). */
export const DELETE = api({ orgOptional: true, body: MfaDisable }, async ({ principal, body, audit }) => {
  if (!principal.user) throw errors.forbidden("API keys cannot change MFA");
  if (!rateLimit(`mfa-disable:${principal.user.id}`, 5, 15 * 60_000)) throw errors.tooMany();
  const r = await run(disableMfa(principal.user.id, body.password));
  if (!r) throw errors.notFound();
  await audit("me.mfa_disabled", { type: "user", id: principal.user.id, name: principal.user.email });
  return r;
});
