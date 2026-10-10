/**
 * Organization administration: profile + settings/branding, IP allowlist, SSO provider listing and the
 * org-scoped generic settings (`org:<orgId>:<key>`). Plain errors only: routes translate ServiceError to HTTP.
 */
import { and, eq, isNull, sql } from "drizzle-orm";
import { getDb, schema } from "../db";
import { bus } from "../bus";
import { getSetting, setSetting } from "./settings";
import { SETTING_SCHEMAS, type SettingKey } from "../api/contracts/settings";
import type { OrgPatchT, IpAllowlistCreateT } from "../api/contracts/org";
import type { OrgSettings, OrgBranding } from "../db/schema/tenancy";

/** Error raised by administration services; routes map `status` to the HTTP response. */
export class ServiceError extends Error {
  constructor(public status: number, message: string, public code = "error") {
    super(message);
    this.name = "ServiceError";
  }
}

export interface OrgSecuritySettings { sessionHours?: number; requireMfa?: boolean; ipAllowlistEnabled?: boolean; passwordMinLength?: number; lockoutThreshold?: number; sessionConsent?: OrgSettings["sessionConsent"]; sessionRecording?: OrgSettings["sessionRecording"]; jitAccess?: boolean }
export type OrgSettingsExt = OrgSettings & { defaultSiteId?: string | null; security?: OrgSecuritySettings };

export type Organization = typeof schema.organizations.$inferSelect;

export async function getOrgRow(orgId: string): Promise<Organization | null> {
  const db = await getDb();
  const [org] = await db.select().from(schema.organizations).where(eq(schema.organizations.id, orgId));
  return org ?? null;
}

export async function getOrg(orgId: string) {
  const db = await getDb();
  const org = await getOrgRow(orgId);
  if (!org) return null;
  const [[sites], [groups], [devices], [members], [pendingInvites]] = await Promise.all([
    db.select({ n: sql<number>`count(*)::int` }).from(schema.sites).where(eq(schema.sites.orgId, orgId)),
    db.select({ n: sql<number>`count(*)::int` }).from(schema.deviceGroups).where(eq(schema.deviceGroups.orgId, orgId)),
    db.select({ n: sql<number>`count(*)::int` }).from(schema.devices).where(and(eq(schema.devices.orgId, orgId), sql`${schema.devices.status} <> 'decommissioned'`)),
    db.select({ n: sql<number>`count(*)::int` }).from(schema.memberships).where(eq(schema.memberships.orgId, orgId)),
    db.select({ n: sql<number>`count(*)::int` }).from(schema.invites).where(and(eq(schema.invites.orgId, orgId), isNull(schema.invites.acceptedAt), sql`${schema.invites.expiresAt} > now()`)),
  ]);
  return { ...org, counts: { sites: sites.n, groups: groups.n, devices: devices.n, members: members.n, pendingInvites: pendingInvites.n } };
}

function stripUndefined<T extends Record<string, unknown>>(o: T): T {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as T;
}

/** Merge a partial update into the organization's name, settings (incl. `security`) and branding. */
export async function updateOrg(orgId: string, patch: OrgPatchT) {
  const db = await getDb();
  const org = await getOrgRow(orgId);
  if (!org) return null;
  const settings = { ...(org.settings as OrgSettingsExt) };
  if (patch.settings) {
    const { security, ...general } = patch.settings;
    if (general.defaultSiteId) {
      const [site] = await db.select({ id: schema.sites.id }).from(schema.sites).where(and(eq(schema.sites.id, general.defaultSiteId), eq(schema.sites.orgId, orgId)));
      if (!site) throw new ServiceError(400, "defaultSiteId does not belong to this organization", "bad_request");
    }
    Object.assign(settings, stripUndefined(general));
    if (security) {
      settings.security = { ...(settings.security ?? {}), ...stripUndefined(security) };
      if (security.requireMfa !== undefined) settings.requireMfa = security.requireMfa;
      if (security.sessionConsent !== undefined) settings.sessionConsent = security.sessionConsent;
      if (security.sessionRecording !== undefined) settings.sessionRecording = security.sessionRecording;
      if (security.jitAccess !== undefined) settings.jitAccess = security.jitAccess;
    }
  }
  const branding: OrgBranding = { ...org.branding, ...(patch.branding ? stripUndefined(patch.branding) : {}) };
  for (const k of Object.keys(branding) as (keyof OrgBranding)[]) if (branding[k] === "") delete branding[k];
  const [row] = await db.update(schema.organizations).set({ name: patch.name ?? org.name, settings: settings as OrgSettings, branding, updatedAt: new Date() }).where(eq(schema.organizations.id, orgId)).returning();
  bus.publish("org.updated", { orgId, name: row.name, changed: Object.keys(patch) }, { orgId });
  return row;
}

/* ---- IP allowlist ---- */

const IPV4 = /^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}$/;
const IPV6 = /^[0-9a-fA-F:]+$/;

/** Validate an IPv4/IPv6 address or CIDR. Returns the normalised value or null. */
export function normalizeCidr(input: string): string | null {
  const s = input.trim();
  const [addr, prefix, ...rest] = s.split("/");
  if (rest.length || !addr) return null;
  if (IPV4.test(addr)) {
    if (prefix === undefined) return `${addr}/32`;
    const n = Number(prefix);
    return Number.isInteger(n) && n >= 0 && n <= 32 ? `${addr}/${n}` : null;
  }
  if (addr.includes(":") && IPV6.test(addr) && addr.split("::").length <= 2) {
    if (prefix === undefined) return `${addr.toLowerCase()}/128`;
    const n = Number(prefix);
    return Number.isInteger(n) && n >= 0 && n <= 128 ? `${addr.toLowerCase()}/${n}` : null;
  }
  return null;
}

export async function listIpAllowlist(orgId: string) {
  const db = await getDb();
  return db.select().from(schema.ipAllowlist).where(eq(schema.ipAllowlist.orgId, orgId)).orderBy(schema.ipAllowlist.createdAt);
}

export async function addIpAllowlist(orgId: string, input: IpAllowlistCreateT) {
  const cidr = normalizeCidr(input.cidr);
  if (!cidr) throw new ServiceError(400, "Enter a valid IPv4/IPv6 address or CIDR range (e.g. 203.0.113.0/24)", "bad_request");
  const db = await getDb();
  const dup = await db.select({ id: schema.ipAllowlist.id }).from(schema.ipAllowlist).where(and(eq(schema.ipAllowlist.orgId, orgId), eq(schema.ipAllowlist.cidr, cidr)));
  if (dup.length) throw new ServiceError(409, "This range is already on the allowlist", "conflict");
  const [row] = await db.insert(schema.ipAllowlist).values({ orgId, cidr, note: input.note ?? null, appliesTo: input.appliesTo }).returning();
  bus.publish("org.ip_allowlist.updated", { orgId, action: "added", cidr }, { orgId });
  return row;
}

export async function removeIpAllowlist(orgId: string, id: string) {
  const db = await getDb();
  const [row] = await db.delete(schema.ipAllowlist).where(and(eq(schema.ipAllowlist.orgId, orgId), eq(schema.ipAllowlist.id, id))).returning();
  if (row) bus.publish("org.ip_allowlist.updated", { orgId, action: "removed", cidr: row.cidr }, { orgId });
  return row ?? null;
}

/* ---- SSO (read-only listing; secrets never leave the server) ---- */

export async function listSsoProviders(orgId: string) {
  const db = await getDb();
  const rows = await db.select().from(schema.ssoProviders).where(eq(schema.ssoProviders.orgId, orgId)).orderBy(schema.ssoProviders.name);
  return rows.map((r) => ({ id: r.id, type: r.type, name: r.name, enabled: r.enabled, issuer: r.issuer, clientId: r.clientId, emailDomains: r.emailDomains, defaultRoleId: r.defaultRoleId, hasSecret: !!r.clientSecretEnc, createdAt: r.createdAt }));
}

/* ---- Generic org-scoped settings ---- */

const ORG_ROW_KEYS: SettingKey[] = ["general", "branding", "security"];
const settingKey = (orgId: string, key: string) => `org:${orgId}:${key}`;

/** Read a settings document. `general`/`branding`/`security` are views over the organization row; the rest live in the settings table. */
export async function getOrgSettingValue(orgId: string, key: SettingKey): Promise<{ key: SettingKey; value: Record<string, unknown>; updatedAt: Date | null; source: "organization" | "settings" } | null> {
  const org = await getOrgRow(orgId);
  if (!org) return null;
  const s = org.settings as OrgSettingsExt;
  if (key === "general") {
    const { security: _s, ...general } = s;
    void _s;
    return { key, value: general as Record<string, unknown>, updatedAt: org.updatedAt, source: "organization" };
  }
  if (key === "branding") return { key, value: org.branding as Record<string, unknown>, updatedAt: org.updatedAt, source: "organization" };
  if (key === "security") {
    const sec = { requireMfa: s.requireMfa ?? false, sessionConsent: s.sessionConsent, sessionRecording: s.sessionRecording, jitAccess: s.jitAccess, ...(s.security ?? {}) };
    return { key, value: stripUndefined(sec) as Record<string, unknown>, updatedAt: org.updatedAt, source: "organization" };
  }
  const stored = await getSetting<Record<string, unknown> | null>(settingKey(orgId, key), null);
  const parsed = SETTING_SCHEMAS[key].safeParse(stored ?? {});
  const value = (parsed.success ? parsed.data : stored ?? {}) as Record<string, unknown>;
  const db = await getDb();
  const [row] = await db.select({ updatedAt: schema.settings.updatedAt }).from(schema.settings).where(eq(schema.settings.key, settingKey(orgId, key)));
  return { key, value, updatedAt: row?.updatedAt ?? null, source: "settings" };
}

/** Validate and store a settings document (replace semantics for settings-table keys, merge for org-row keys). */
export async function setOrgSettingValue(orgId: string, key: SettingKey, value: unknown) {
  const parsed = SETTING_SCHEMAS[key].safeParse(value);
  if (!parsed.success) throw new ServiceError(400, `Invalid ${key} settings: ${parsed.error.issues.map((i) => `${i.path.join(".") || "value"} ${i.message}`).join("; ")}`, "bad_request");
  if (ORG_ROW_KEYS.includes(key)) {
    const patch: OrgPatchT = key === "general" ? { settings: parsed.data as OrgPatchT["settings"] } : key === "security" ? { settings: { security: parsed.data as NonNullable<OrgPatchT["settings"]>["security"] } } : { branding: parsed.data as OrgPatchT["branding"] };
    const row = await updateOrg(orgId, patch);
    if (!row) return null;
  } else {
    await setSetting(settingKey(orgId, key), parsed.data);
    bus.publish("org.settings.updated", { orgId, key }, { orgId });
  }
  return getOrgSettingValue(orgId, key);
}
