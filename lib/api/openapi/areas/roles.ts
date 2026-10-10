import { z } from "zod";
import { endpoint, type EndpointDoc } from "../registry";
import { RoleCreate, RoleDeleteQuery, RoleListResponse, RolePatch, RoleSchema } from "../../contracts/roles";

const area: EndpointDoc[] = [
  endpoint({
    method: "GET", path: "/api/v1/roles", operationId: "listRoles", tag: "Roles", permission: "users.view", risk: "read",
    summary: "List roles and the permission catalogue", response: RoleListResponse,
    notes: ["System roles (Owner, Administrator, Technician, Help Desk, Read only, Client Administrator) have `isSystem: true` and are read-only.", "`catalog` groups every permission key by area with its description; use it to build or explain a role."],
    aiHint: "Use to look up a role id before inviting or re-assigning a member, or to explain what a role can do.",
  }),
  endpoint({
    method: "POST", path: "/api/v1/roles", operationId: "createRole", tag: "Roles", permission: "users.manage", risk: "write",
    summary: "Create a custom role", body: RoleCreate, response: RoleSchema,
    bodyExample: { name: "Patch operator", description: "Approves and deploys patches", permissions: ["devices.view", "patches.view", "patches.manage", "jobs.view"] },
    notes: ["`permissions` must be concrete keys from the catalogue (no wildcards).", "Pass `cloneFrom: <roleId>` with an empty `permissions` list to copy another role's permissions (wildcards are expanded).", "Role names are unique per organization (case-insensitive).", "Emits `role.created`."],
    aiHint: "Use to create a least-privilege role for a team (e.g. help desk that may only view devices and run scripts).",
  }),
  endpoint({ method: "GET", path: "/api/v1/roles/{id}", operationId: "getRole", tag: "Roles", permission: "users.view", risk: "read", summary: "Get one role", params: { id: "Role id" }, response: RoleSchema, aiHint: "Use to read a role's exact permission list." }),
  endpoint({
    method: "PATCH", path: "/api/v1/roles/{id}", operationId: "updateRole", tag: "Roles", permission: "users.manage", risk: "write",
    summary: "Edit a custom role", params: { id: "Role id" }, body: RolePatch, response: RoleSchema,
    notes: ["System roles answer 409 `system_role`: clone them instead.", "Members holding the role get the new permissions on their next request.", "The audit entry records added and removed permissions. Emits `role.updated`."],
    aiHint: "Use to grant or revoke a permission for everyone holding a custom role.",
  }),
  endpoint({
    method: "DELETE", path: "/api/v1/roles/{id}", operationId: "deleteRole", tag: "Roles", permission: "users.manage", risk: "dangerous",
    summary: "Delete a custom role", params: { id: "Role id" }, query: RoleDeleteQuery, response: z.object({ ok: z.literal(true) }),
    notes: ["Refused (409 `role_in_use`) while members hold the role unless `?reassignTo=<roleId>` moves them first.", "Emits `role.deleted`."],
    aiHint: "Use to retire an unused custom role; pass reassignTo when members still hold it.",
  }),
];
export default area;
