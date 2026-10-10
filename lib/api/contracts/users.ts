/**
 * Contracts for organization members (users) - shared by the route handlers and the OpenAPI registry.
 * Contracts never import lib/api/route (they are loaded at boot through the endpoint registry).
 */
import { z } from "zod";

/** Pagination + search query shared by every list endpoint in the administration area. */
export const PageQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(500).default(50),
  q: z.string().max(200).optional(),
  sort: z.string().max(60).optional(),
  dir: z.enum(["asc", "desc"]).optional(),
});
export type PageQueryT = z.infer<typeof PageQuery>;

export const Paginated = <T extends z.ZodType>(item: T) => z.object({ items: z.array(item), total: z.number().int(), page: z.number().int(), pageSize: z.number().int(), pages: z.number().int() });

export const MemberStatus = z.enum(["active", "suspended", "invited", "locked"]);

export const UserListQuery = PageQuery.extend({
  roleId: z.string().optional(),
  status: MemberStatus.optional(),
  siteId: z.string().optional(),
});
export type UserListQueryT = z.infer<typeof UserListQuery>;

export const MemberPatch = z
  .object({
    roleId: z.string().min(1).optional(),
    siteIds: z.array(z.string().min(1)).max(500).optional(),
    groupIds: z.array(z.string().min(1)).max(500).optional(),
    status: z.enum(["active", "suspended"]).optional(),
    name: z.string().min(1).max(120).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: "Nothing to update" });
export type MemberPatchT = z.infer<typeof MemberPatch>;

export const MemberSchema = z.object({
  id: z.string().describe("User id"),
  membershipId: z.string(),
  email: z.string(),
  name: z.string(),
  avatarUrl: z.string().nullable(),
  status: MemberStatus,
  isSuperAdmin: z.boolean(),
  totpEnabled: z.boolean(),
  roleId: z.string(),
  roleName: z.string(),
  roleIsSystem: z.boolean(),
  permissions: z.array(z.string()),
  siteIds: z.array(z.string()),
  groupIds: z.array(z.string()),
  isDefault: z.boolean(),
  lastLoginAt: z.string().nullable(),
  lastLoginIp: z.string().nullable(),
  joinedAt: z.string(),
});

export const MemberListResponse = Paginated(MemberSchema).extend({ counts: z.object({ total: z.number(), active: z.number(), suspended: z.number(), admins: z.number(), mfa: z.number() }).optional() });
