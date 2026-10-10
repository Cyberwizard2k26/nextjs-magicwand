import { api, ApiError } from "@/lib/api/route";
import { RoleCreate } from "@/lib/api/contracts/roles";
import { createRole, listRoles, permissionCatalog } from "@/lib/services/roles";
import { ServiceError } from "@/lib/services/org";

export const dynamic = "force-dynamic";

const run = <T>(p: Promise<T>) => p.catch((e: unknown) => { throw e instanceof ServiceError ? new ApiError(e.status, e.message, e.code) : e; });

/** System roles plus this organization's custom roles, with member counts and the permission catalogue. */
export const GET = api({ permission: "users.view" }, async ({ orgId }) => ({ items: await listRoles(orgId), catalog: permissionCatalog() }));

/** Create a custom role. Permissions must be concrete keys from the catalogue; `cloneFrom` copies another role's permissions. */
export const POST = api({ permission: "users.manage", body: RoleCreate }, async ({ orgId, body, audit }) => {
  const role = await run(createRole(orgId, body));
  await audit("role.created", { type: "role", id: role.id, name: role.name }, { permissions: role.permissions, cloneFrom: body.cloneFrom });
  return role;
});
