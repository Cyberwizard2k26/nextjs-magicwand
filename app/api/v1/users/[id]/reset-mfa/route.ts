import { api, errors } from "@/lib/api/route";
import { resetMemberMfa } from "@/lib/services/users";

export const dynamic = "force-dynamic";

/** Clear a member's authenticator and recovery codes (they sign in with password only until they re-enrol) and revoke their sessions. */
export const POST = api({ permission: "users.manage" }, async ({ orgId, params, audit }) => {
  const member = await resetMemberMfa(orgId, params.id);
  if (!member) throw errors.notFound("Member not found");
  await audit("user.mfa_reset", { type: "user", id: member.id, name: member.email });
  return { ok: true, totpEnabled: false };
});
