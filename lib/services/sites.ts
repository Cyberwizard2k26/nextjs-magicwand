/**
 * Sites (physical locations) of an organization: listing with device/group/member counts, CRUD and safe deletion
 * (devices must be moved with `reassignTo` first).
 */
import { and, asc, eq, ilike, inArray, sql } from "drizzle-orm";
import { getDb, schema } from "../db";
import { bus } from "../bus";
import type { SiteCreateT, SitePatchT } from "../api/contracts/sites";
import { ServiceError } from "./org";

export type Site = typeof schema.sites.$inferSelect;

const counts = {
  deviceCount: sql<number>`(select count(*)::int from ${schema.devices} d where d.site_id = ${schema.sites.id} and d.status <> 'decommissioned')`,
  onlineCount: sql<number>`(select count(*)::int from ${schema.devices} d where d.site_id = ${schema.sites.id} and d.status = 'online')`,
  groupCount: sql<number>`(select count(*)::int from ${schema.deviceGroups} g where g.site_id = ${schema.sites.id})`,
  memberCount: sql<number>`(select count(*)::int from ${schema.memberships} m where m.org_id = ${schema.sites.orgId} and m.site_ids @> to_jsonb(array[${schema.sites.id}]))`,
};

export async function listSites(orgId: string, opts: { q?: string; siteIds?: string[] } = {}) {
  const db = await getDb();
  const where = [eq(schema.sites.orgId, orgId)];
  if (opts.siteIds?.length) where.push(inArray(schema.sites.id, opts.siteIds));
  if (opts.q) where.push(ilike(schema.sites.name, `%${opts.q.replace(/[%_]/g, "\\$&")}%`));
  const rows = await db.select({ site: schema.sites, ...counts }).from(schema.sites).where(and(...where)).orderBy(asc(schema.sites.name));
  return rows.map(({ site, ...c }) => ({ ...site, ...c }));
}

export async function getSite(orgId: string, id: string) {
  const db = await getDb();
  const [row] = await db.select({ site: schema.sites, ...counts }).from(schema.sites).where(and(eq(schema.sites.orgId, orgId), eq(schema.sites.id, id)));
  if (!row) return null;
  const groups = await db.select({ id: schema.deviceGroups.id, name: schema.deviceGroups.name, isDynamic: schema.deviceGroups.isDynamic }).from(schema.deviceGroups).where(and(eq(schema.deviceGroups.orgId, orgId), eq(schema.deviceGroups.siteId, id))).orderBy(schema.deviceGroups.name);
  const members = await db.select({ userId: schema.users.id, name: schema.users.name, email: schema.users.email, roleName: schema.roles.name }).from(schema.memberships).innerJoin(schema.users, eq(schema.users.id, schema.memberships.userId)).innerJoin(schema.roles, eq(schema.roles.id, schema.memberships.roleId)).where(and(eq(schema.memberships.orgId, orgId), sql`${schema.memberships.siteIds} @> ${JSON.stringify([id])}::jsonb`));
  const platforms = await db.select({ platform: schema.devices.platform, n: sql<number>`count(*)::int` }).from(schema.devices).where(and(eq(schema.devices.siteId, id), sql`${schema.devices.status} <> 'decommissioned'`)).groupBy(schema.devices.platform);
  const { site, ...c } = row;
  return { ...site, ...c, groups, members, platforms: Object.fromEntries(platforms.map((p) => [p.platform, p.n])) };
}

const clean = <T extends Record<string, unknown>>(o: T) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as T;

function normalizeNetworks(networks?: string[]) {
  if (!networks) return undefined;
  const out = [...new Set(networks.map((n) => n.trim()).filter(Boolean))];
  for (const n of out) if (!/^[0-9a-fA-F:.]+(\/\d{1,3})?$/.test(n)) throw new ServiceError(400, `"${n}" is not a valid network range (use CIDR, e.g. 10.0.0.0/24)`, "bad_request");
  return out;
}

export async function createSite(orgId: string, input: SiteCreateT) {
  const db = await getDb();
  const dup = await db.select({ id: schema.sites.id }).from(schema.sites).where(and(eq(schema.sites.orgId, orgId), sql`lower(${schema.sites.name}) = lower(${input.name.trim()})`));
  if (dup.length) throw new ServiceError(409, `A site named "${input.name}" already exists`, "conflict");
  const [row] = await db.insert(schema.sites).values({ orgId, name: input.name.trim(), address: input.address ?? null, timezone: input.timezone ?? "UTC", contactName: input.contactName ?? null, contactEmail: input.contactEmail || null, contactPhone: input.contactPhone ?? null, networks: normalizeNetworks(input.networks) ?? [], location: input.location ?? null, settings: input.settings ?? {}, customFields: input.customFields ?? {} }).returning();
  bus.publish("site.created", { id: row.id, name: row.name }, { orgId });
  return (await getSite(orgId, row.id))!;
}

export async function updateSite(orgId: string, id: string, patch: SitePatchT) {
  const db = await getDb();
  const [site] = await db.select().from(schema.sites).where(and(eq(schema.sites.orgId, orgId), eq(schema.sites.id, id)));
  if (!site) return null;
  if (patch.name && patch.name.trim().toLowerCase() !== site.name.toLowerCase()) {
    const dup = await db.select({ id: schema.sites.id }).from(schema.sites).where(and(eq(schema.sites.orgId, orgId), sql`lower(${schema.sites.name}) = lower(${patch.name.trim()})`));
    if (dup.length) throw new ServiceError(409, `A site named "${patch.name}" already exists`, "conflict");
  }
  const set = clean({ name: patch.name?.trim(), address: patch.address, timezone: patch.timezone, contactName: patch.contactName, contactEmail: patch.contactEmail === "" ? null : patch.contactEmail, contactPhone: patch.contactPhone, networks: normalizeNetworks(patch.networks), location: patch.location, settings: patch.settings ? { ...site.settings, ...patch.settings } : undefined, customFields: patch.customFields ? { ...site.customFields, ...patch.customFields } : undefined });
  await db.update(schema.sites).set({ ...set, updatedAt: new Date() }).where(eq(schema.sites.id, id));
  bus.publish("site.updated", { id, name: set.name ?? site.name, changed: Object.keys(set) }, { orgId });
  return (await getSite(orgId, id))!;
}

/** Delete a site. Devices must be moved with `reassignTo`; groups are detached and site scopes trimmed. */
export async function deleteSite(orgId: string, id: string, reassignTo?: string) {
  const db = await getDb();
  const site = await getSite(orgId, id);
  if (!site) return null;
  if (reassignTo === id) throw new ServiceError(400, "reassignTo must be a different site", "bad_request");
  let target: { id: string; name: string } | null = null;
  if (reassignTo) {
    const [t] = await db.select({ id: schema.sites.id, name: schema.sites.name }).from(schema.sites).where(and(eq(schema.sites.orgId, orgId), eq(schema.sites.id, reassignTo)));
    if (!t) throw new ServiceError(400, "reassignTo site not found in this organization", "bad_request");
    target = t;
  }
  if (site.deviceCount > 0 && !target) throw new ServiceError(409, `${site.deviceCount} device${site.deviceCount === 1 ? " is" : "s are"} assigned to this site. Pass reassignTo=<siteId> to move them.`, "site_in_use");
  const [{ n: totalSites }] = await db.select({ n: sql<number>`count(*)::int` }).from(schema.sites).where(eq(schema.sites.orgId, orgId));
  if (totalSites <= 1) throw new ServiceError(409, "An organization needs at least one site", "last_site");
  if (target) {
    await db.update(schema.devices).set({ siteId: target.id }).where(eq(schema.devices.siteId, id));
    await db.update(schema.deviceGroups).set({ siteId: target.id }).where(eq(schema.deviceGroups.siteId, id));
    await db.update(schema.enrollmentTokens).set({ siteId: target.id }).where(eq(schema.enrollmentTokens.siteId, id));
  }
  // Trim the site from scoped memberships (a membership scoped only to this site becomes org-wide unless reassigned).
  const scoped = await db.select({ id: schema.memberships.id, siteIds: schema.memberships.siteIds }).from(schema.memberships).where(and(eq(schema.memberships.orgId, orgId), sql`${schema.memberships.siteIds} @> ${JSON.stringify([id])}::jsonb`));
  for (const m of scoped) {
    const next = m.siteIds.filter((s) => s !== id);
    if (target && !next.includes(target.id)) next.push(target.id);
    await db.update(schema.memberships).set({ siteIds: next }).where(eq(schema.memberships.id, m.id));
  }
  await db.delete(schema.sites).where(eq(schema.sites.id, id));
  bus.publish("site.deleted", { id, name: site.name, movedTo: target?.id ?? null, devicesMoved: target ? site.deviceCount : 0 }, { orgId });
  return { site, movedTo: target, devicesMoved: target ? site.deviceCount : 0, membersUpdated: scoped.length };
}
