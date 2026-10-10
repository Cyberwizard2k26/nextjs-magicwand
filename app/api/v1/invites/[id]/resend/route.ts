import { api, ApiError, errors } from "@/lib/api/route";
import { resendInvite } from "@/lib/services/invites";
import { ServiceError } from "@/lib/services/org";
import { config } from "@/lib/config";

export const dynamic = "force-dynamic";

/** Issue a fresh link (the old one stops working) and send the email again. */
export const POST = api({ permission: "users.manage" }, async ({ orgId, params, principal, audit, req }) => {
  const origin = req.headers.get("origin") || config.publicUrl;
  const r = await resendInvite(orgId, params.id, { id: principal.user?.id ?? null, name: principal.user?.name ?? null }, origin).catch((e: unknown) => { throw e instanceof ServiceError ? new ApiError(e.status, e.message, e.code) : e; });
  if (!r) throw errors.notFound("Invitation not found");
  await audit("invite.resent", { type: "invite", id: r.invite.id, name: r.invite.email }, { emailSent: r.emailSent });
  return r;
});
