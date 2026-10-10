import { api, ApiError } from "@/lib/api/route";
import { GroupCreate, GroupListQuery } from "@/lib/api/contracts/groups";
import { createGroup, FILTER_FIELDS, listGroups } from "@/lib/services/groups";
import { siteScope } from "@/lib/services/device-access";
import { ServiceError } from "@/lib/services/org";

export const dynamic = "force-dynamic";

/** Device groups as a depth-first tree with live member counts (static membership + dynamic filters), plus the filter field catalogue. */
export const GET = api({ permission: "devices.view", query: GroupListQuery }, async ({ orgId, query, principal }) => ({ items: await listGroups(orgId, { q: query.q, siteId: query.siteId, siteIds: siteScope(principal, orgId) }), filterFields: FILTER_FIELDS }));

/** Create a static group (optionally with initial members) or a dynamic group driven by a filter. */
export const POST = api({ permission: "groups.manage", body: GroupCreate }, async ({ orgId, body, principal, audit }) => {
  const group = await createGroup(orgId, body, siteScope(principal, orgId)).catch((e: unknown) => { throw e instanceof ServiceError ? new ApiError(e.status, e.message, e.code) : e; });
  await audit("group.created", { type: "group", id: group.id, name: group.name }, { isDynamic: group.isDynamic, filter: group.filter, parentId: group.parentId, members: body.deviceIds?.length ?? 0 });
  return group;
});
