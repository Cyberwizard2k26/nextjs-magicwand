import { api, ApiError, errors } from "@/lib/api/route";
import { GroupMembersBody, GroupPreviewQuery } from "@/lib/api/contracts/groups";
import { addGroupMembers, listGroupDevices, removeGroupMembers } from "@/lib/services/groups";
import { siteScope } from "@/lib/services/device-access";
import { ServiceError } from "@/lib/services/org";

export const dynamic = "force-dynamic";

const run = <T>(p: Promise<T>) => p.catch((e: unknown) => { throw e instanceof ServiceError ? new ApiError(e.status, e.message, e.code) : e; });

/** Devices currently in the group (live evaluation for dynamic groups). */
export const GET = api({ permission: "devices.view", query: GroupPreviewQuery.extend({ q: GroupMembersBody.shape.deviceIds.element.optional() }) }, async ({ orgId, params, query, principal }) => {
  const page = await listGroupDevices(orgId, params.id, { ...query, siteIds: siteScope(principal, orgId) });
  if (!page) throw errors.notFound("Group not found");
  return page;
});

/** Add devices to a static group. */
export const POST = api({ permission: "groups.manage", body: GroupMembersBody }, async ({ orgId, params, body, principal, audit }) => {
  const r = await run(addGroupMembers(orgId, params.id, body.deviceIds, siteScope(principal, orgId)));
  if (!r) throw errors.notFound("Group not found");
  await audit("group.members_added", { type: "group", id: params.id }, { deviceIds: body.deviceIds, added: r.added });
  return r;
});

/** Remove devices from a static group. */
export const DELETE = api({ permission: "groups.manage", body: GroupMembersBody }, async ({ orgId, params, body, audit }) => {
  const r = await run(removeGroupMembers(orgId, params.id, body.deviceIds));
  if (!r) throw errors.notFound("Group not found");
  await audit("group.members_removed", { type: "group", id: params.id }, { deviceIds: body.deviceIds, removed: r.removed });
  return r;
});
