import { api, ApiError, errors } from "@/lib/api/route";
import { MemberPatch } from "@/lib/api/contracts/users";
import { getMember, removeMember, updateMember } from "@/lib/services/users";
import { ServiceError } from "@/lib/services/org";

export const dynamic = "force-dynamic";

const run = <T>(p: Promise<T>) => p.catch((e: unknown) => { throw e instanceof ServiceError ? new ApiError(e.status, e.message, e.code) : e; });

export const GET = api({ permission: "users.view" }, async ({ orgId, params }) => {
  const member = await getMember(orgId, params.id);
  if (!member) throw errors.notFound("Member not found");
  return member;
});

/** Change a member's role, site/group scope, display name or status (active | suspended). */
export const PATCH = api({ permission: "users.manage", body: MemberPatch }, async ({ orgId, params, body, principal, audit }) => {
  const r = await run(updateMember(orgId, params.id, body, { id: principal.user?.id ?? null }));
  if (!r) throw errors.notFound("Member not found");
  await audit("user.updated", { type: "user", id: r.after.id, name: r.after.email }, { changed: Object.keys(body), roleId: body.roleId, roleName: body.roleId ? r.after.roleName : undefined, status: body.status, siteIds: body.siteIds, groupIds: body.groupIds });
  return r.after;
});

/** Remove the member from the organization (the user account itself is kept). */
export const DELETE = api({ permission: "users.manage" }, async ({ orgId, params, principal, audit }) => {
  const member = await run(removeMember(orgId, params.id, { id: principal.user?.id ?? null }));
  if (!member) throw errors.notFound("Member not found");
  await audit("user.removed", { type: "user", id: member.id, name: member.email }, { roleName: member.roleName });
  return { ok: true, removed: member.id };
});
