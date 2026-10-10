import { api, errors } from "@/lib/api/route";
import { listSessions, revokeOtherSessions } from "@/lib/services/account";

export const dynamic = "force-dynamic";

/** Active browser sessions of the signed-in user (the current one is flagged). */
export const GET = api({ orgOptional: true }, async ({ principal }) => {
  if (!principal.user) throw errors.forbidden("API keys do not have sessions");
  return { items: await listSessions(principal.user.id, principal.session?.id ?? null) };
});

/** Sign out everywhere except here. */
export const DELETE = api({ orgOptional: true }, async ({ principal, audit }) => {
  if (!principal.user) throw errors.forbidden("API keys do not have sessions");
  const revoked = await revokeOtherSessions(principal.user.id, principal.session?.id ?? null);
  await audit("me.sessions_revoked", { type: "user", id: principal.user.id, name: principal.user.email }, { revoked });
  return { ok: true, revoked };
});
