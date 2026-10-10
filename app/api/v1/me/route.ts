import { api, errors } from "@/lib/api/route";
import { MePatch } from "@/lib/api/contracts/account";
import { getMe, updateMe } from "@/lib/services/account";

export const dynamic = "force-dynamic";

/** The signed-in user's profile, security state (MFA, passkeys), preferences and memberships. */
export const GET = api({ orgOptional: true }, async ({ principal, orgId }) => {
  if (!principal.user) throw errors.forbidden("API keys do not have a profile");
  const me = await getMe(principal.user.id, orgId || null);
  if (!me) throw errors.notFound();
  return me;
});

/** Update name, phone, timezone, avatar URL or UI preferences (merged). */
export const PATCH = api({ orgOptional: true, body: MePatch }, async ({ principal, body, audit }) => {
  if (!principal.user) throw errors.forbidden("API keys do not have a profile");
  const me = await updateMe(principal.user.id, body);
  if (!me) throw errors.notFound();
  await audit("me.updated", { type: "user", id: me.id, name: me.email }, { changed: Object.keys(body) });
  return me;
});
