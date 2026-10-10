import { api, ApiError, errors } from "@/lib/api/route";
import { GroupPatch } from "@/lib/api/contracts/groups";
import { deleteGroup, getGroup, updateGroup } from "@/lib/services/groups";
import { ServiceError } from "@/lib/services/org";

export const dynamic = "force-dynamic";

const run = <T>(p: Promise<T>) => p.catch((e: unknown) => { throw e instanceof ServiceError ? new ApiError(e.status, e.message, e.code) : e; });

export const GET = api({ permission: "devices.view" }, async ({ orgId, params }) => {
  const group = await getGroup(orgId, params.id);
  if (!group) throw errors.notFound("Group not found");
  return group;
});

/** Rename, recolour, move (parentId), re-scope (siteId) or change the filter / dynamic flag of a group. */
export const PATCH = api({ permission: "groups.manage", body: GroupPatch }, async ({ orgId, params, body, audit }) => {
  const group = await run(updateGroup(orgId, params.id, body));
  if (!group) throw errors.notFound("Group not found");
  await audit("group.updated", { type: "group", id: group.id, name: group.name }, { changed: Object.keys(body), filter: body.filter });
  return group;
});

/** Delete a group. Child groups move up to its parent; devices keep running. */
export const DELETE = api({ permission: "groups.manage" }, async ({ orgId, params, audit }) => {
  const group = await run(deleteGroup(orgId, params.id));
  if (!group) throw errors.notFound("Group not found");
  await audit("group.deleted", { type: "group", id: group.id, name: group.name }, { isDynamic: group.isDynamic, children: group.children.length });
  return { ok: true };
});
