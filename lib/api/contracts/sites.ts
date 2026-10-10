import { z } from "zod";

export const SiteListQuery = z.object({ q: z.string().max(200).optional() });

export const SiteCreate = z.object({
  name: z.string().min(1).max(120),
  address: z.string().max(400).nullable().optional(),
  timezone: z.string().max(64).optional(),
  contactName: z.string().max(120).nullable().optional(),
  contactEmail: z.email().max(254).nullable().optional().or(z.literal("")),
  contactPhone: z.string().max(40).nullable().optional(),
  /** CIDR ranges used by network discovery at this site. */
  networks: z.array(z.string().min(1).max(64)).max(50).optional(),
  location: z.object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) }).nullable().optional(),
  settings: z.record(z.string(), z.unknown()).optional(),
  customFields: z.record(z.string(), z.unknown()).optional(),
});
export type SiteCreateT = z.infer<typeof SiteCreate>;
export const SitePatch = SiteCreate.partial().refine((v) => Object.keys(v).length > 0, { message: "Nothing to update" });
export type SitePatchT = z.infer<typeof SitePatch>;

export const SiteDeleteQuery = z.object({ reassignTo: z.string().optional() });

export const SiteSchema = z.object({
  id: z.string(),
  name: z.string(),
  address: z.string().nullable(),
  timezone: z.string().nullable(),
  contactName: z.string().nullable(),
  contactEmail: z.string().nullable(),
  contactPhone: z.string().nullable(),
  networks: z.array(z.string()),
  location: z.object({ lat: z.number(), lng: z.number() }).nullable(),
  settings: z.record(z.string(), z.unknown()),
  customFields: z.record(z.string(), z.unknown()),
  deviceCount: z.number().int(),
  onlineCount: z.number().int(),
  groupCount: z.number().int(),
  memberCount: z.number().int(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
