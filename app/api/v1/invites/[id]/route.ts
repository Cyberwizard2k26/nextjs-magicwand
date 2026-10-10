import { api, errors } from "@/lib/api/route";
import { getInvite, revokeInvite } from "@/lib/services/invites";

export const dynamic = "force-dynamic";

export const GET = api({ permission: "users.view" }, async ({ orgId, params }) => {
  const invite = await getInvite(orgId, params.id);
  if (!invite) throw errors.notFound("Invitation not found");
  return invite;
});

/** Revoke an invitation: its link stops working immediately. */
export const DELETE = api({ permission: "users.manage" }, async ({ orgId, params, audit }) => {
  const row = await revokeInvite(orgId, params.id);
  if (!row) throw errors.notFound("Invitation not found");
  await audit("invite.revoked", { type: "invite", id: row.id, name: row.email });
  return { ok: true };
});
