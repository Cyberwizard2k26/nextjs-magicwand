import { api, ApiError, errors } from "@/lib/api/route";
import { revokeSession } from "@/lib/services/account";
import { ServiceError } from "@/lib/services/org";

export const dynamic = "force-dynamic";

/** Sign out one other session. */
export const DELETE = api({ orgOptional: true }, async ({ principal, params, audit }) => {
  if (!principal.user) throw errors.forbidden("API keys do not have sessions");
  const row = await revokeSession(principal.user.id, params.id, principal.session?.id ?? null).catch((e: unknown) => { throw e instanceof ServiceError ? new ApiError(e.status, e.message, e.code) : e; });
  if (!row) throw errors.notFound("Session not found");
  await audit("me.session_revoked", { type: "session", id: params.id });
  return { ok: true };
});
