import { z } from "zod";
import { endpoint, type EndpointDoc } from "../registry";
import { FilterPreviewBody, GroupCreate, GroupListQuery, GroupMembersBody, GroupPatch, GroupPreviewQuery, GroupPreviewResponse, GroupSchema } from "../../contracts/groups";

const FilterFieldSchema = z.object({ field: z.string(), label: z.string(), type: z.enum(["string", "number", "boolean", "enum", "array"]), values: z.array(z.string()).optional() });

const area: EndpointDoc[] = [
  endpoint({
    method: "GET", path: "/api/v1/groups", operationId: "listGroups", tag: "Groups", permission: "devices.view", risk: "read",
    summary: "List device groups (tree) with live counts", query: GroupListQuery, response: z.object({ items: z.array(GroupSchema), filterFields: z.array(FilterFieldSchema) }),
    notes: ["Depth-first order: parents precede children; `depth` gives the nesting level.", "Counts include static members and devices matched by dynamic filters.", "`filterFields` lists the fields and operators the dynamic filter language supports."],
    aiHint: "Use to resolve a group name to its id for job/policy targeting, or to see how devices are organised.",
  }),
  endpoint({
    method: "POST", path: "/api/v1/groups", operationId: "createGroup", tag: "Groups", permission: "groups.manage", risk: "write",
    summary: "Create a static or dynamic group", body: GroupCreate, response: GroupSchema,
    bodyExample: { name: "Windows servers pending reboot", isDynamic: true, filter: { all: [{ field: "platform", op: "eq", value: "windows" }, { field: "deviceType", op: "in", value: ["server", "vm"] }, { field: "pendingReboot", op: "eq", value: true }] } },
    notes: ["Dynamic groups need a `filter` with at least one clause (`all` = AND, `any` = OR); operators: eq, neq, contains, startsWith, gt, lt, gte, lte, in, exists, regex.", "Static groups may receive initial `deviceIds`.", "`parentId` nests the group; cycles are rejected.", "Emits `group.created`."],
    aiHint: "Use to organise devices for targeting; prefer a dynamic group when membership can be expressed as a rule (platform, tags, OS, health) so it stays current automatically.",
  }),
  endpoint({ method: "POST", path: "/api/v1/groups/preview", operationId: "previewGroupFilter", tag: "Groups", permission: "devices.view", risk: "read", summary: "Preview which devices an unsaved filter matches", body: FilterPreviewBody, response: GroupPreviewResponse.extend({ fleet: z.number() }), aiHint: "Use before creating a dynamic group to verify the rule matches the intended devices." }),
  endpoint({ method: "GET", path: "/api/v1/groups/{id}", operationId: "getGroup", tag: "Groups", permission: "devices.view", risk: "read", summary: "Get a group with its child groups", params: { id: "Group id" }, response: GroupSchema.extend({ children: z.array(z.object({ id: z.string(), name: z.string(), isDynamic: z.boolean(), deviceCount: z.number() })) }), aiHint: "Use to read a group's filter or nesting." }),
  endpoint({ method: "PATCH", path: "/api/v1/groups/{id}", operationId: "updateGroup", tag: "Groups", permission: "groups.manage", risk: "write", summary: "Edit a group (name, colour, parent, site, filter)", params: { id: "Group id" }, body: GroupPatch, response: GroupSchema, notes: ["Switching a group to dynamic clears its static members.", "Emits `group.updated`."], aiHint: "Use to refine a dynamic group's rule or move a group in the tree." }),
  endpoint({ method: "DELETE", path: "/api/v1/groups/{id}", operationId: "deleteGroup", tag: "Groups", permission: "groups.manage", risk: "dangerous", summary: "Delete a group", params: { id: "Group id" }, response: z.object({ ok: z.literal(true) }), notes: ["Child groups move up to the deleted group's parent; devices are untouched.", "Policies or schedules targeting the group will resolve to zero devices afterwards.", "Emits `group.deleted`."], aiHint: "Use to remove an obsolete group; check nothing targets it first." }),
  endpoint({ method: "GET", path: "/api/v1/groups/{id}/members", operationId: "listGroupMembers", tag: "Groups", permission: "devices.view", risk: "read", summary: "List devices in a group", params: { id: "Group id" }, query: GroupPreviewQuery.extend({ q: z.string().optional() }), response: GroupPreviewResponse, aiHint: "Use to enumerate the devices a group currently contains (dynamic groups are evaluated live)." }),
  endpoint({ method: "POST", path: "/api/v1/groups/{id}/members", operationId: "addGroupMembers", tag: "Groups", permission: "groups.manage", risk: "write", summary: "Add devices to a static group", params: { id: "Group id" }, body: GroupMembersBody, response: z.object({ added: z.number(), total: z.number() }), notes: ["409 `dynamic_group` for dynamic groups.", "Device ids must belong to the organization (and the caller's sites).", "Emits `group.members_changed`."], aiHint: "Use to put specific devices into a hand-picked group." }),
  endpoint({ method: "DELETE", path: "/api/v1/groups/{id}/members", operationId: "removeGroupMembers", tag: "Groups", permission: "groups.manage", risk: "write", summary: "Remove devices from a static group", params: { id: "Group id" }, body: GroupMembersBody, response: z.object({ removed: z.number() }), aiHint: "Use to take devices out of a static group." }),
  endpoint({ method: "GET", path: "/api/v1/groups/{id}/preview", operationId: "previewGroup", tag: "Groups", permission: "devices.view", risk: "read", summary: "Resolve a group's devices right now", params: { id: "Group id" }, query: GroupPreviewQuery, response: GroupPreviewResponse, aiHint: "Use to double-check what a dynamic group matches before targeting it with a job." }),
  endpoint({ method: "POST", path: "/api/v1/groups/{id}/move", operationId: "moveGroup", tag: "Groups", permission: "groups.manage", risk: "write", summary: "Move a group up or down among its siblings", params: { id: "Group id" }, body: z.object({ direction: z.enum(["up", "down"]) }), response: z.object({ moved: z.boolean() }), aiHint: "Use to reorder groups in the tree." }),
];
export default area;
