import { z } from "zod";
import { PageQuery } from "./users";

export const AuditQuery = PageQuery.extend({
  actorId: z.string().optional(),
  actorType: z.enum(["user", "agent", "system", "apikey", "automation", "contact"]).optional(),
  /** Action name or prefix, e.g. `auth.` or `device.reboot`. */
  action: z.string().max(120).optional(),
  targetType: z.string().max(60).optional(),
  targetId: z.string().max(120).optional(),
  /** ISO timestamp (inclusive). */
  from: z.string().optional(),
  /** ISO timestamp (exclusive). */
  to: z.string().optional(),
  export: z.enum(["csv"]).optional(),
  facets: z.coerce.boolean().optional(),
});
export type AuditQueryT = z.infer<typeof AuditQuery>;

export const AuditEntry = z.object({
  id: z.string(),
  actorType: z.string(),
  actorId: z.string().nullable(),
  actorName: z.string().nullable(),
  action: z.string(),
  targetType: z.string().nullable(),
  targetId: z.string().nullable(),
  targetName: z.string().nullable(),
  ip: z.string().nullable(),
  userAgent: z.string().nullable(),
  details: z.record(z.string(), z.unknown()),
  createdAt: z.string(),
});
export const AuditListResponse = z.object({
  items: z.array(AuditEntry),
  total: z.number().int(),
  page: z.number().int(),
  pageSize: z.number().int(),
  pages: z.number().int(),
  facets: z.object({ actions: z.array(z.object({ action: z.string(), n: z.number() })), targetTypes: z.array(z.object({ targetType: z.string(), n: z.number() })), actors: z.array(z.object({ actorId: z.string(), actorName: z.string().nullable(), n: z.number() })) }).optional(),
});
