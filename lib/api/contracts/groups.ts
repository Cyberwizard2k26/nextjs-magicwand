import { z } from "zod";

export const FilterOp = z.enum(["eq", "neq", "contains", "startsWith", "gt", "lt", "gte", "lte", "in", "exists", "regex"]);
export const FilterClause = z.object({ field: z.string().min(1).max(80), op: FilterOp, value: z.unknown().optional() });
/** Dynamic group filter: every clause in `all` must match and at least one clause in `any` (when present). */
export const DeviceFilterSchema = z.object({ all: z.array(FilterClause).max(50).optional(), any: z.array(FilterClause).max(50).optional() });
export type DeviceFilterT = z.infer<typeof DeviceFilterSchema>;

export const GroupListQuery = z.object({ q: z.string().max(200).optional(), siteId: z.string().optional(), flat: z.coerce.boolean().optional() });

export const GroupCreate = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(400).nullable().optional(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).nullable().optional(),
  icon: z.string().max(40).nullable().optional(),
  siteId: z.string().nullable().optional(),
  parentId: z.string().nullable().optional(),
  isDynamic: z.boolean().default(false),
  filter: DeviceFilterSchema.nullable().optional(),
  sortOrder: z.number().int().min(0).max(100000).optional(),
  /** Static groups only: initial members. */
  deviceIds: z.array(z.string()).max(5000).optional(),
});
export type GroupCreateT = z.infer<typeof GroupCreate>;
export const GroupPatch = GroupCreate.omit({ deviceIds: true }).partial().refine((v) => Object.keys(v).length > 0, { message: "Nothing to update" });
export type GroupPatchT = z.infer<typeof GroupPatch>;

export const GroupMembersBody = z.object({ deviceIds: z.array(z.string().min(1)).min(1).max(5000) });
export const GroupPreviewQuery = z.object({ page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(200).default(50) });
/** Preview an arbitrary filter (not yet saved) against the fleet. */
export const FilterPreviewBody = z.object({ filter: DeviceFilterSchema, page: z.number().int().min(1).default(1), pageSize: z.number().int().min(1).max(200).default(50) });

export const GroupSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  color: z.string().nullable(),
  icon: z.string().nullable(),
  siteId: z.string().nullable(),
  siteName: z.string().nullable(),
  parentId: z.string().nullable(),
  isDynamic: z.boolean(),
  filter: DeviceFilterSchema.nullable(),
  sortOrder: z.number().int(),
  deviceCount: z.number().int(),
  onlineCount: z.number().int(),
  depth: z.number().int(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const GroupDeviceSchema = z.object({ id: z.string(), name: z.string(), hostname: z.string().nullable(), platform: z.string(), deviceType: z.string(), status: z.string(), osName: z.string().nullable(), siteId: z.string().nullable(), lastSeenAt: z.string().nullable(), loggedInUser: z.string().nullable(), tags: z.array(z.string()) });
export const GroupPreviewResponse = z.object({ items: z.array(GroupDeviceSchema), total: z.number().int(), page: z.number().int(), pageSize: z.number().int(), pages: z.number().int() });
