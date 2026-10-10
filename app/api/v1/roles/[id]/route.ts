import { api, ApiError, errors } from "@/lib/api/route";
import { RoleDeleteQuery, RolePatch } from "@/lib/api/contracts/roles";
import { deleteRole, getRole, updateRole } from "@/lib/services/roles";
import { ServiceError } from "@/lib/services/org";

export const dynamic = "force-dynamic";

const run = <T>(p: Promise<T>) => p.catch((e: unknown) => { throw e instanceof ServiceError ? new ApiError(e.status, e.message, e.code) : e; });

export const GET = api({ permission: "users.view" }, async ({ orgId, params }) => {
  const role = await getRole(orgId, params.id);
  if (!role) throw errors.notFound("Role not found");
  return role;
});

/** Edit a custom role (system roles are read-only). */
export const PATCH = api({ permission: "users.manage", body: RolePatch }, async ({ orgId, params, body, audit }) => {
  const role = await run(updateRole(orgId, params.id, body));
  if (!role) throw errors.notFound("Role not found");
  await audit("role.updated", { type: "role", id: role.id, name: role.name }, { changed: Object.keys(body), ...role.diff });
  const { diff: _d, ...rest } = role;
  void _d;
  return rest;
});

/** Delete a custom role. When members still hold it, pass `?reassignTo=<roleId>`. */
export const DELETE = api({ permission: "users.manage", query: RoleDeleteQuery }, async ({ orgId, params, query, audit }) => {
  const role = await run(deleteRole(orgId, params.id, query.reassignTo));
  if (!role) throw errors.notFound("Role not found");
  await audit("role.deleted", { type: "role", id: role.id, name: role.name }, { reassignedTo: query.reassignTo ?? null, members: role.memberCount });
  return { ok: true };
});
