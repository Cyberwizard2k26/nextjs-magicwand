import { z } from "zod";

export const OrgSecurity = z.object({
  /** Browser session lifetime in hours (1-720). */
  sessionHours: z.number().int().min(1).max(720).optional(),
  requireMfa: z.boolean().optional(),
  ipAllowlistEnabled: z.boolean().optional(),
  passwordMinLength: z.number().int().min(8).max(128).optional(),
  lockoutThreshold: z.number().int().min(3).max(50).optional(),
  sessionConsent: z.enum(["never", "notify", "ask", "ask_if_user_present"]).optional(),
  sessionRecording: z.enum(["off", "desktop", "all"]).optional(),
  jitAccess: z.boolean().optional(),
});
export const OrgGeneral = z.object({
  timezone: z.string().max(64).optional(),
  locale: z.string().max(16).optional(),
  defaultSiteId: z.string().nullable().optional(),
  dataRetentionDays: z.number().int().min(7).max(3650).optional(),
  agentUpdateChannel: z.enum(["stable", "beta"]).optional(),
  agentAutoUpdate: z.boolean().optional(),
});
export const OrgBrandingSchema = z.object({
  productName: z.string().max(60).optional(),
  logoUrl: z.string().max(2048).optional(),
  accentColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional().or(z.literal("")),
  supportEmail: z.email().max(254).optional().or(z.literal("")),
  supportPhone: z.string().max(40).optional(),
  supportUrl: z.string().max(2048).optional(),
  trayMessage: z.string().max(200).optional(),
  portalDomain: z.string().max(253).optional(),
});

export const OrgPatch = z
  .object({
    name: z.string().min(1).max(120).optional(),
    settings: OrgGeneral.extend({ security: OrgSecurity.optional() }).partial().optional(),
    branding: OrgBrandingSchema.partial().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: "Nothing to update" });
export type OrgPatchT = z.infer<typeof OrgPatch>;

export const OrgResponse = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string(),
  kind: z.enum(["msp", "client", "internal"]),
  status: z.enum(["active", "suspended", "archived"]),
  settings: z.record(z.string(), z.unknown()),
  branding: z.record(z.string(), z.unknown()),
  createdAt: z.string(),
  updatedAt: z.string(),
  counts: z.object({ sites: z.number(), groups: z.number(), devices: z.number(), members: z.number(), pendingInvites: z.number() }),
});

export const IpAllowlistCreate = z.object({
  cidr: z.string().min(1).max(64),
  note: z.string().max(200).optional(),
  appliesTo: z.enum(["users", "api", "all"]).default("all"),
});
export type IpAllowlistCreateT = z.infer<typeof IpAllowlistCreate>;
export const IpAllowlistEntry = z.object({ id: z.string(), cidr: z.string(), note: z.string().nullable(), appliesTo: z.enum(["users", "api", "all"]), createdAt: z.string() });

export const SsoProviderSchema = z.object({ id: z.string(), type: z.enum(["oidc", "saml", "ldap"]), name: z.string(), enabled: z.boolean(), issuer: z.string().nullable(), clientId: z.string().nullable(), emailDomains: z.array(z.string()), defaultRoleId: z.string().nullable(), hasSecret: z.boolean(), createdAt: z.string() });

/* ---- Custom field definitions ---- */
export const CustomFieldEntity = z.enum(["device", "site", "organization", "ticket", "contact"]);
export const CustomFieldType = z.enum(["text", "number", "boolean", "date", "select", "multiselect", "url", "secret"]);
export const CustomFieldListQuery = z.object({ entity: CustomFieldEntity.optional() });
export const CustomFieldCreate = z.object({
  entity: CustomFieldEntity,
  key: z.string().min(1).max(40).regex(/^[a-z][a-z0-9_]*$/, "lowercase letters, digits and underscores; must start with a letter"),
  label: z.string().min(1).max(80),
  type: CustomFieldType,
  options: z.array(z.string().min(1).max(80)).max(100).default([]),
  required: z.boolean().default(false),
  sourcePath: z.string().max(200).nullable().optional(),
  sortOrder: z.number().int().min(0).max(10000).optional(),
});
export type CustomFieldCreateT = z.infer<typeof CustomFieldCreate>;
export const CustomFieldPatch = CustomFieldCreate.omit({ entity: true, key: true }).partial().refine((v) => Object.keys(v).length > 0, { message: "Nothing to update" });
export type CustomFieldPatchT = z.infer<typeof CustomFieldPatch>;
export const CustomFieldSchema = z.object({ id: z.string(), entity: CustomFieldEntity, key: z.string(), label: z.string(), type: CustomFieldType, options: z.array(z.string()), required: z.boolean(), sourcePath: z.string().nullable(), sortOrder: z.number().int(), createdAt: z.string() });
