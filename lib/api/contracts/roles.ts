import { z } from "zod";

const PermissionList = z.array(z.string().min(3).max(60)).max(200);

export const RoleCreate = z.object({
  name: z.string().min(1).max(80),
  description: z.string().max(300).optional(),
  permissions: PermissionList,
  /** Copy permissions from an existing role (system or custom) when `permissions` is omitted. */
  cloneFrom: z.string().optional(),
});
export type RoleCreateT = z.infer<typeof RoleCreate>;

export const RolePatch = z
  .object({ name: z.string().min(1).max(80).optional(), description: z.string().max(300).nullable().optional(), permissions: PermissionList.optional() })
  .refine((v) => Object.keys(v).length > 0, { message: "Nothing to update" });
export type RolePatchT = z.infer<typeof RolePatch>;

export const RoleDeleteQuery = z.object({ reassignTo: z.string().optional() });

export const RoleSchema = z.object({
  id: z.string(),
  orgId: z.string().nullable(),
  name: z.string(),
  description: z.string().nullable(),
  permissions: z.array(z.string()),
  isSystem: z.boolean(),
  memberCount: z.number().int(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const RoleListResponse = z.object({
  items: z.array(RoleSchema),
  /** Permission catalogue grouped by area so clients can render a matrix without hard-coding keys. */
  catalog: z.array(z.object({ area: z.string(), label: z.string(), permissions: z.array(z.object({ key: z.string(), label: z.string() })) })),
});
