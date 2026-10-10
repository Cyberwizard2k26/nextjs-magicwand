import { z } from "zod";

export const INTEGRATION_TYPES = [
  "psa_connectwise", "psa_autotask", "psa_halo", "psa_syncro", "psa_jira", "psa_zendesk", "psa_freshservice",
  "docs_itglue", "docs_hudu",
  "chat_slack", "chat_teams", "chat_discord",
  "identity_entra", "identity_google", "identity_okta", "identity_ldap",
  "backup_veeam", "backup_acronis", "backup_datto", "backup_generic",
  "security_defender", "security_sentinelone", "security_crowdstrike", "security_bitdefender", "security_huntress",
  "mdm_intune", "mdm_jamf",
  "warranty_dell", "warranty_lenovo", "warranty_hp",
  "oob_intel_amt", "oob_redfish", "oob_ipmi",
  "vuln_osv", "vuln_nvd",
  "storage_s3", "smtp", "sms_twilio", "generic_webhook", "custom",
] as const;
export const IntegrationType = z.enum(INTEGRATION_TYPES);

export const IntegrationListQuery = z.object({ category: z.string().max(40).optional(), q: z.string().max(200).optional() });

export const IntegrationCreate = z.object({
  type: IntegrationType,
  name: z.string().min(1).max(120),
  enabled: z.boolean().default(true),
  /** Non-secret settings (validated against the catalog field list for the type). */
  config: z.record(z.string(), z.unknown()).default({}),
  /** Credentials: encrypted at rest, never returned. Keys are the catalog's secret fields. */
  secrets: z.record(z.string(), z.string().max(4096)).default({}),
  syncIntervalMinutes: z.number().int().min(5).max(1440).default(60),
  mappings: z.record(z.string(), z.unknown()).optional(),
});
export type IntegrationCreateT = z.infer<typeof IntegrationCreate>;
export const IntegrationPatch = IntegrationCreate.omit({ type: true }).partial().refine((v) => Object.keys(v).length > 0, { message: "Nothing to update" });
export type IntegrationPatchT = z.infer<typeof IntegrationPatch>;

export const CatalogField = z.object({ key: z.string(), label: z.string(), type: z.enum(["text", "url", "secret", "number", "select", "boolean", "textarea"]), required: z.boolean(), secret: z.boolean(), placeholder: z.string().optional(), help: z.string().optional(), options: z.array(z.string()).optional() });
export const CatalogEntry = z.object({ type: IntegrationType, name: z.string(), category: z.string(), categoryLabel: z.string(), description: z.string(), fields: z.array(CatalogField), docsUrl: z.string().optional(), /** What the platform does with this integration today. */ capabilities: z.array(z.string()) });

export const IntegrationSchema = z.object({
  id: z.string(),
  type: IntegrationType,
  name: z.string(),
  enabled: z.boolean(),
  config: z.record(z.string(), z.unknown()),
  /** Names of the secret fields that are set (values are never returned). */
  secretKeys: z.array(z.string()),
  status: z.enum(["ok", "error", "unconfigured", "syncing"]),
  lastSyncAt: z.string().nullable(),
  lastError: z.string().nullable(),
  syncIntervalMinutes: z.number().int(),
  mappings: z.record(z.string(), z.unknown()),
  createdBy: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export const IntegrationListResponse = z.object({ items: z.array(IntegrationSchema), catalog: z.array(CatalogEntry) });
export const IntegrationTestResponse = z.object({ ok: z.boolean(), status: z.enum(["ok", "error"]), checks: z.array(z.object({ name: z.string(), ok: z.boolean(), detail: z.string().optional() })), durationMs: z.number() });
