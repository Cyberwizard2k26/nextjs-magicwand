import { api, ApiError, errors } from "@/lib/api/route";
import { PasswordChange } from "@/lib/api/contracts/account";
import { changePassword } from "@/lib/services/account";
import { ServiceError } from "@/lib/services/org";
import { rateLimit } from "@/lib/util/rate-limit";

export const dynamic = "force-dynamic";

/** Change the password (current password required). Every other session is signed out. */
export const POST = api({ orgOptional: true, body: PasswordChange }, async ({ principal, body, audit }) => {
  if (!principal.user) throw errors.forbidden("API keys cannot change passwords");
  if (!rateLimit(`pwchange:${principal.user.id}`, 5, 15 * 60_000)) throw errors.tooMany();
  const r = await changePassword(principal.user.id, body.currentPassword, body.newPassword, principal.session?.id ?? null).catch((e: unknown) => { throw e instanceof ServiceError ? new ApiError(e.status, e.message, e.code) : e; });
  if (!r) throw errors.notFound();
  await audit("me.password_changed", { type: "user", id: principal.user.id, name: principal.user.email }, { revokedSessions: r.revokedSessions });
  return { ok: true, ...r };
});
