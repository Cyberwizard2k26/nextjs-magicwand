import { api, ApiError } from "@/lib/api/route";
import { InviteCreate, InviteListQuery } from "@/lib/api/contracts/invites";
import { createInvite, listInvites } from "@/lib/services/invites";
import { ServiceError } from "@/lib/services/org";
import { config } from "@/lib/config";

export const dynamic = "force-dynamic";

const run = <T>(p: Promise<T>) => p.catch((e: unknown) => { throw e instanceof ServiceError ? new ApiError(e.status, e.message, e.code) : e; });

/** Invitations of the active organization (pending by default). */
export const GET = api({ permission: "users.view", query: InviteListQuery }, async ({ orgId, query }) => ({ items: await listInvites(orgId, query.status) }));

/** Invite a person by email. The link is emailed when SMTP is configured, otherwise returned once as `inviteUrl`. */
export const POST = api({ permission: "users.manage", body: InviteCreate }, async ({ orgId, body, principal, audit, req }) => {
  const origin = req.headers.get("origin") || config.publicUrl;
  const r = await run(createInvite(orgId, body, { id: principal.user?.id ?? null, name: principal.user?.name ?? principal.apiKey?.name ?? null }, origin));
  await audit("invite.created", { type: "invite", id: r.invite.id, name: r.invite.email }, { roleId: body.roleId, roleName: r.invite.roleName, siteIds: body.siteIds, emailSent: r.emailSent, expiresInDays: body.expiresInDays });
  return r;
});
