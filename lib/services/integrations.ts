/**
 * Third-party integrations: a catalog of supported connectors (what each needs and does), CRUD over the `integrations`
 * table with credentials encrypted at rest, and a connectivity test that validates configuration and reachability.
 * Status is honest: `ok` means the last test passed, never "synced".
 */
import { and, asc, eq, ilike, or, sql } from "drizzle-orm";
import { getDb, schema } from "../db";
import { bus } from "../bus";
import { decryptJson, encryptJson } from "../util/crypto";
import type { IntegrationType } from "../db/schema/integrations";
import type { IntegrationCreateT, IntegrationPatchT } from "../api/contracts/integrations";
import { ServiceError } from "./org";

export type Integration = typeof schema.integrations.$inferSelect;

export interface CatalogField { key: string; label: string; type: "text" | "url" | "secret" | "number" | "select" | "boolean" | "textarea"; required: boolean; secret: boolean; placeholder?: string; help?: string; options?: string[] }
export interface CatalogEntry { type: IntegrationType; name: string; category: string; categoryLabel: string; description: string; fields: CatalogField[]; docsUrl?: string; capabilities: string[] }

const CATEGORY_LABELS: Record<string, string> = { psa: "PSA & ticketing", docs: "Documentation", chat: "Chat & notifications", identity: "Identity", backup: "Backup", security: "Security & EDR", mdm: "Device management", warranty: "Warranty lookup", oob: "Out-of-band management", vuln: "Vulnerability feeds", storage: "Storage", email: "Email", sms: "SMS", webhook: "Generic", custom: "Custom" };

const f = (key: string, label: string, type: CatalogField["type"], opts: Partial<CatalogField> = {}): CatalogField => ({ key, label, type, required: opts.required ?? true, secret: type === "secret", ...opts });
const url = (key = "baseUrl", label = "Base URL", placeholder = "https://") => f(key, label, "url", { placeholder });
const apiKey = (key = "apiKey", label = "API key") => f(key, label, "secret");
const oauth = [f("clientId", "Client ID", "text"), f("clientSecret", "Client secret", "secret")];
const WEBHOOK_CAP = ["Receive alert, device and job notifications"];
const TICKET_CAP = ["Create tickets from alerts", "Sync companies and configurations", "Time entries"];

function entry(type: IntegrationType, name: string, description: string, fields: CatalogField[], capabilities: string[], docsUrl?: string): CatalogEntry {
  const category = type.includes("_") ? type.split("_")[0] : type === "smtp" ? "email" : type;
  return { type, name, category, categoryLabel: CATEGORY_LABELS[category] ?? category, description, fields, capabilities, docsUrl };
}

export const INTEGRATION_CATALOG: CatalogEntry[] = [
  entry("psa_connectwise", "ConnectWise Manage", "Two-way ticketing and configuration sync with ConnectWise PSA.", [url("baseUrl", "Site URL", "https://api-na.myconnectwise.net"), f("companyId", "Company ID", "text"), f("publicKey", "Public key", "text"), f("privateKey", "Private key", "secret"), f("clientId", "Client ID", "text")], TICKET_CAP, "https://developer.connectwise.com"),
  entry("psa_autotask", "Datto Autotask", "Ticketing and company sync with Autotask PSA.", [f("username", "API user", "text"), f("secret", "API secret", "secret"), f("integrationCode", "Tracking identifier", "text")], TICKET_CAP),
  entry("psa_halo", "HaloPSA", "Tickets, assets and clients from HaloPSA.", [url(), ...oauth, f("tenant", "Tenant", "text", { required: false })], TICKET_CAP),
  entry("psa_syncro", "Syncro", "Tickets and customers from Syncro.", [url("baseUrl", "Subdomain URL", "https://yourcompany.syncromsp.com"), apiKey()], TICKET_CAP),
  entry("psa_jira", "Jira Service Management", "Create and update Jira issues from alerts and tickets.", [url("baseUrl", "Site URL", "https://yourcompany.atlassian.net"), f("email", "Account email", "text"), f("apiToken", "API token", "secret"), f("projectKey", "Project key", "text")], ["Create issues from alerts", "Link tickets to issues"]),
  entry("psa_zendesk", "Zendesk", "Tickets in Zendesk Support.", [url("baseUrl", "Subdomain URL", "https://yourcompany.zendesk.com"), f("email", "Agent email", "text"), f("apiToken", "API token", "secret")], ["Create tickets from alerts"]),
  entry("psa_freshservice", "Freshservice", "Tickets and assets in Freshservice.", [url("baseUrl", "Domain", "https://yourcompany.freshservice.com"), apiKey()], ["Create tickets from alerts", "Asset sync"]),
  entry("docs_itglue", "IT Glue", "Push device configurations and passwords to IT Glue.", [url("baseUrl", "API URL", "https://api.itglue.com"), apiKey()], ["Configuration sync", "Flexible assets"]),
  entry("docs_hudu", "Hudu", "Document devices and passwords in Hudu.", [url("baseUrl", "Hudu URL", "https://docs.yourcompany.com"), apiKey()], ["Asset sync", "Password sync"]),
  entry("chat_slack", "Slack", "Post alerts and job results to a Slack channel.", [f("webhookUrl", "Incoming webhook URL", "secret", { help: "Create one under Slack Apps -> Incoming Webhooks" }), f("channel", "Channel", "text", { required: false, placeholder: "#noc" })], WEBHOOK_CAP),
  entry("chat_teams", "Microsoft Teams", "Post adaptive cards to a Teams channel.", [f("webhookUrl", "Incoming webhook URL", "secret")], WEBHOOK_CAP),
  entry("chat_discord", "Discord", "Post alerts to a Discord channel.", [f("webhookUrl", "Webhook URL", "secret")], WEBHOOK_CAP),
  entry("identity_entra", "Microsoft Entra ID", "Sign-in with Entra ID and user provisioning.", [f("tenantId", "Tenant ID", "text"), ...oauth], ["Single sign-on", "Directory user import"]),
  entry("identity_google", "Google Workspace", "Sign-in with Google and user provisioning.", [...oauth, f("hostedDomain", "Hosted domain", "text", { required: false })], ["Single sign-on", "Directory user import"]),
  entry("identity_okta", "Okta", "Sign-in with Okta.", [url("baseUrl", "Okta domain", "https://yourcompany.okta.com"), ...oauth], ["Single sign-on"]),
  entry("identity_ldap", "LDAP / Active Directory", "Authenticate technicians against LDAP.", [url("baseUrl", "LDAP URL", "ldaps://dc01.corp.local:636"), f("bindDn", "Bind DN", "text"), f("bindPassword", "Bind password", "secret"), f("baseDn", "Search base", "text")], ["Authentication"]),
  entry("backup_veeam", "Veeam", "Backup job status from Veeam Backup & Replication.", [url(), f("username", "Username", "text"), f("password", "Password", "secret")], ["Backup status alerts"]),
  entry("backup_acronis", "Acronis Cyber Protect", "Backup status from Acronis.", [url("baseUrl", "Data center URL", "https://eu-cloud.acronis.com"), ...oauth], ["Backup status alerts"]),
  entry("backup_datto", "Datto BCDR", "Backup status from Datto.", [f("publicKey", "Public key", "text"), f("secretKey", "Secret key", "secret")], ["Backup status alerts"]),
  entry("backup_generic", "Generic backup (webhook)", "Receive backup results from any product via webhook.", [f("sharedSecret", "Shared secret", "secret")], ["Backup status alerts"]),
  entry("security_defender", "Microsoft Defender for Endpoint", "Threat and device risk data from Defender.", [f("tenantId", "Tenant ID", "text"), ...oauth], ["Threat alerts", "Device risk score"]),
  entry("security_sentinelone", "SentinelOne", "Threats and agent status from SentinelOne.", [url("baseUrl", "Console URL", "https://yourcompany.sentinelone.net"), f("apiToken", "API token", "secret")], ["Threat alerts", "Agent status"]),
  entry("security_crowdstrike", "CrowdStrike Falcon", "Detections from Falcon.", [url("baseUrl", "API base", "https://api.crowdstrike.com"), ...oauth], ["Threat alerts"]),
  entry("security_bitdefender", "Bitdefender GravityZone", "Endpoint status from GravityZone.", [url("baseUrl", "API URL", "https://cloud.gravityzone.bitdefender.com"), apiKey()], ["Threat alerts", "Agent status"]),
  entry("security_huntress", "Huntress", "Incident reports from Huntress.", [apiKey(), f("apiSecret", "API secret", "secret")], ["Incident alerts"]),
  entry("mdm_intune", "Microsoft Intune", "Device compliance from Intune.", [f("tenantId", "Tenant ID", "text"), ...oauth], ["Compliance state", "Device matching"]),
  entry("mdm_jamf", "Jamf Pro", "Mac inventory and compliance from Jamf.", [url("baseUrl", "Jamf URL", "https://yourcompany.jamfcloud.com"), ...oauth], ["Inventory enrichment"]),
  entry("warranty_dell", "Dell TechDirect", "Warranty lookup for Dell hardware.", [...oauth], ["Warranty dates"]),
  entry("warranty_lenovo", "Lenovo", "Warranty lookup for Lenovo hardware.", [f("clientId", "Client ID", "secret")], ["Warranty dates"]),
  entry("warranty_hp", "HP", "Warranty lookup for HP hardware.", [apiKey()], ["Warranty dates"]),
  entry("oob_intel_amt", "Intel AMT / vPro", "Power control for AMT-provisioned machines.", [f("username", "Username", "text"), f("password", "Password", "secret"), f("tls", "Use TLS", "boolean", { required: false })], ["Out-of-band power control"]),
  entry("oob_redfish", "Redfish (BMC)", "Server power and health through Redfish.", [f("username", "Username", "text"), f("password", "Password", "secret")], ["Power control", "Hardware health"]),
  entry("oob_ipmi", "IPMI", "Power control through IPMI.", [f("username", "Username", "text"), f("password", "Password", "secret")], ["Power control"]),
  entry("vuln_osv", "OSV.dev", "Open-source vulnerability feed (no credentials needed).", [url("baseUrl", "API URL", "https://api.osv.dev")], ["Software vulnerability matching"]),
  entry("vuln_nvd", "NIST NVD", "CVE feed from the National Vulnerability Database.", [url("baseUrl", "API URL", "https://services.nvd.nist.gov"), apiKey("apiKey", "API key (optional, raises rate limits)")], ["CVE enrichment"]),
  entry("storage_s3", "S3-compatible storage", "Store uploads, recordings and reports in S3 / MinIO / R2.", [url("endpoint", "Endpoint", "https://s3.eu-west-1.amazonaws.com"), f("bucket", "Bucket", "text"), f("region", "Region", "text", { required: false }), f("accessKeyId", "Access key ID", "text"), f("secretAccessKey", "Secret access key", "secret")], ["Attachment storage", "Report archive"]),
  entry("smtp", "SMTP relay", "Send email through your own SMTP server.", [f("host", "Host", "text"), f("port", "Port", "number", { placeholder: "587" }), f("username", "Username", "text", { required: false }), f("password", "Password", "secret"), f("from", "From address", "text"), f("secure", "Use TLS", "boolean", { required: false })], ["Invitations", "Alert emails", "Reports"]),
  entry("sms_twilio", "Twilio SMS", "Text technicians about critical alerts.", [f("accountSid", "Account SID", "text"), f("authToken", "Auth token", "secret"), f("from", "From number", "text", { placeholder: "+15551234567" })], ["Critical alert SMS"]),
  entry("generic_webhook", "Generic webhook", "POST events to any HTTP endpoint (prefer Settings -> Webhooks for signed deliveries).", [url("url", "Endpoint URL"), f("secret", "Shared secret", "secret", { required: false })], WEBHOOK_CAP),
  entry("custom", "Custom", "Store settings and credentials for an in-house integration.", [f("notes", "Notes", "textarea", { required: false })], ["Credential storage"]),
];

export function catalogEntry(type: string): CatalogEntry | undefined {
  return INTEGRATION_CATALOG.find((c) => c.type === type);
}

/** Split a flat field map into non-secret config and secret values according to the catalog. */
function splitByCatalog(type: IntegrationType, config: Record<string, unknown>, secrets: Record<string, string>) {
  const cat = catalogEntry(type);
  if (!cat) throw new ServiceError(400, `Unknown integration type ${type}`, "bad_request");
  const secretKeys = new Set(cat.fields.filter((x) => x.secret).map((x) => x.key));
  const cfg: Record<string, unknown> = {};
  const sec: Record<string, string> = { ...secrets };
  for (const [k, v] of Object.entries(config)) {
    if (secretKeys.has(k)) { if (typeof v === "string" && v) sec[k] = v; }
    else cfg[k] = v;
  }
  for (const k of Object.keys(sec)) if (!secretKeys.has(k)) throw new ServiceError(400, `"${k}" is not a credential field for ${cat.name}`, "bad_request");
  return { cfg, sec, cat };
}

function shape(row: Integration) {
  const { secretsEnc, ...rest } = row;
  let secretKeys: string[] = [];
  if (secretsEnc) { try { secretKeys = Object.keys(decryptJson<Record<string, string>>(secretsEnc)); } catch { secretKeys = ["(undecryptable)"]; } }
  return { ...rest, secretKeys };
}
export type IntegrationView = ReturnType<typeof shape>;

export async function listIntegrations(orgId: string, opts: { category?: string; q?: string } = {}) {
  const db = await getDb();
  const where = [or(eq(schema.integrations.orgId, orgId), sql`${schema.integrations.orgId} is null`)!];
  if (opts.q) where.push(or(ilike(schema.integrations.name, `%${opts.q}%`), ilike(schema.integrations.type, `%${opts.q}%`))!);
  const rows = await db.select().from(schema.integrations).where(and(...where)).orderBy(asc(schema.integrations.name));
  const items = rows.map(shape).filter((r) => !opts.category || catalogEntry(r.type)?.category === opts.category);
  return { items, catalog: INTEGRATION_CATALOG };
}

export async function getIntegration(orgId: string, id: string) {
  const db = await getDb();
  const [row] = await db.select().from(schema.integrations).where(and(eq(schema.integrations.id, id), eq(schema.integrations.orgId, orgId)));
  return row ? shape(row) : null;
}

export async function createIntegration(orgId: string, input: IntegrationCreateT, actor: { id: string | null }) {
  const db = await getDb();
  const { cfg, sec } = splitByCatalog(input.type, input.config, input.secrets);
  const [row] = await db.insert(schema.integrations).values({ orgId, type: input.type, name: input.name.trim(), enabled: input.enabled, config: cfg, secretsEnc: Object.keys(sec).length ? encryptJson(sec) : null, status: "unconfigured", syncIntervalMinutes: input.syncIntervalMinutes, mappings: input.mappings ?? {}, createdBy: actor.id }).returning();
  bus.publish("integration.created", { id: row.id, type: row.type, name: row.name }, { orgId });
  return shape(row);
}

export async function updateIntegration(orgId: string, id: string, patch: IntegrationPatchT) {
  const db = await getDb();
  const [row] = await db.select().from(schema.integrations).where(and(eq(schema.integrations.id, id), eq(schema.integrations.orgId, orgId)));
  if (!row) return null;
  const existingSecrets = row.secretsEnc ? decryptJson<Record<string, string>>(row.secretsEnc) : {};
  const { cfg, sec } = splitByCatalog(row.type, patch.config ?? row.config, patch.secrets ?? {});
  const merged = { ...existingSecrets, ...sec };
  for (const [k, v] of Object.entries(patch.secrets ?? {})) if (v === "") delete merged[k];
  const set: Partial<typeof schema.integrations.$inferInsert> = { updatedAt: new Date() };
  if (patch.name !== undefined) set.name = patch.name.trim();
  if (patch.enabled !== undefined) set.enabled = patch.enabled;
  if (patch.config !== undefined || patch.secrets !== undefined) { set.config = cfg; set.secretsEnc = Object.keys(merged).length ? encryptJson(merged) : null; set.status = "unconfigured"; set.lastError = null; }
  if (patch.syncIntervalMinutes !== undefined) set.syncIntervalMinutes = patch.syncIntervalMinutes;
  if (patch.mappings !== undefined) set.mappings = patch.mappings;
  const [updated] = await db.update(schema.integrations).set(set).where(eq(schema.integrations.id, id)).returning();
  bus.publish("integration.updated", { id, type: updated.type, name: updated.name, changed: Object.keys(patch) }, { orgId });
  return shape(updated);
}

export async function deleteIntegration(orgId: string, id: string) {
  const db = await getDb();
  const [row] = await db.delete(schema.integrations).where(and(eq(schema.integrations.id, id), eq(schema.integrations.orgId, orgId))).returning();
  if (!row) return null;
  bus.publish("integration.deleted", { id, type: row.type, name: row.name }, { orgId });
  return shape(row);
}

export interface TestCheck { name: string; ok: boolean; detail?: string }

/** Validate required fields and, when the type has an endpoint URL, check that it answers HTTP. */
export async function testIntegration(orgId: string, id: string) {
  const db = await getDb();
  const [row] = await db.select().from(schema.integrations).where(and(eq(schema.integrations.id, id), eq(schema.integrations.orgId, orgId)));
  if (!row) return null;
  const cat = catalogEntry(row.type);
  const started = Date.now();
  const checks: TestCheck[] = [];
  const secrets = row.secretsEnc ? decryptJson<Record<string, string>>(row.secretsEnc) : {};
  if (!cat) checks.push({ name: "Catalog", ok: false, detail: `Unknown type ${row.type}` });
  else {
    const missing = cat.fields.filter((x) => x.required && !(x.secret ? secrets[x.key] : row.config[x.key] !== undefined && row.config[x.key] !== "")).map((x) => x.label);
    checks.push({ name: "Required fields", ok: missing.length === 0, detail: missing.length ? `Missing: ${missing.join(", ")}` : `${cat.fields.filter((x) => x.required).length} required field(s) present` });
    const urlField = cat.fields.find((x) => x.type === "url");
    const raw = urlField ? row.config[urlField.key] : undefined;
    if (urlField && typeof raw === "string" && raw) {
      let u: URL | null = null;
      try { u = new URL(raw); } catch { /* handled below */ }
      if (!u) checks.push({ name: "Endpoint URL", ok: false, detail: `"${raw}" is not a valid URL` });
      else if (!/^https?:$/.test(u.protocol)) checks.push({ name: "Endpoint URL", ok: true, detail: `${u.protocol.replace(":", "").toUpperCase()} endpoint recorded (reachability is checked at sync time)` });
      else {
        try {
          const r = await fetch(u.toString(), { method: "GET", redirect: "manual", signal: AbortSignal.timeout(6000), headers: { "user-agent": "MagicWand-RMM/1.0 (connectivity check)" } });
          checks.push({ name: "Reachability", ok: r.status > 0 && r.status < 500, detail: `HTTP ${r.status} from ${u.host}` });
        } catch (err) {
          const e = err as Error;
          checks.push({ name: "Reachability", ok: false, detail: e?.name === "TimeoutError" ? `${u.host} did not answer within 6s` : `Could not reach ${u.host}: ${e?.message ?? String(err)}` });
        }
      }
    }
    if (row.type === "smtp") {
      const port = Number(row.config.port);
      checks.push({ name: "Port", ok: Number.isInteger(port) && port > 0 && port < 65536, detail: Number.isInteger(port) ? `Port ${port}` : "Port must be a number" });
    }
    if (row.type.startsWith("chat_")) {
      const wh = secrets.webhookUrl ?? "";
      checks.push({ name: "Webhook URL", ok: /^https:\/\//.test(wh), detail: /^https:\/\//.test(wh) ? "HTTPS webhook URL present" : "Webhook URL must start with https://" });
    }
  }
  const ok = checks.every((c) => c.ok);
  await db.update(schema.integrations).set({ status: ok ? "ok" : "error", lastError: ok ? null : checks.filter((c) => !c.ok).map((c) => c.detail ?? c.name).join("; "), updatedAt: new Date() }).where(eq(schema.integrations.id, id));
  bus.publish("integration.tested", { id, type: row.type, name: row.name, ok }, { orgId });
  return { ok, status: ok ? ("ok" as const) : ("error" as const), checks, durationMs: Date.now() - started };
}
