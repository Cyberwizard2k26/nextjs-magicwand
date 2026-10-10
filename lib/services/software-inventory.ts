/**
 * Fleet software inventory: the per-device `device_software` rows aggregated by package name, the unwanted-software
 * watchlist (settings key `software:watchlist:<orgId>`) and the planning helpers that turn "uninstall everywhere" /
 * "install on these devices" into per-manager jobs. Plain Drizzle, no Next.js imports.
 */
import { and, asc, desc, eq, ilike, inArray, isNull, or, sql, type SQL } from "drizzle-orm";
import { getDb, schema } from "../db";
import { bus } from "../bus";
import { getSetting, setSetting } from "./settings";
import { resolveTargets } from "./device-filter";
import type { PackageManager, SoftwarePlatform, WatchlistEntry } from "../api/contracts/software";

const sw = schema.deviceSoftware;
const d = schema.devices;

/** Case-insensitive glob (`*`, `?`) -> SQL LIKE pattern. Without wildcards the term matches anywhere. */
export function likePattern(input: string, wrapWhenPlain = true): string {
  const escaped = input.trim().replace(/[%_\\]/g, "\\$&").replace(/\*/g, "%").replace(/\?/g, "_");
  return wrapWhenPlain && !/[%_]/.test(escaped) ? `%${escaped}%` : escaped;
}

export interface InventoryScope {
  orgId: string;
  q?: string;
  publisher?: string;
  platform?: string[];
  source?: string[];
  siteId?: string;
  /** Membership site scope (undefined = whole org). */
  siteIds?: string[];
  system?: boolean;
}
export interface InventoryParams extends InventoryScope { sort?: string; dir?: "asc" | "desc"; page: number; pageSize: number }

function deviceScope(orgId: string, siteIds?: string[], siteId?: string): SQL[] {
  const where: SQL[] = [eq(d.orgId, orgId), sql`${d.status} <> 'decommissioned'`];
  if (siteIds?.length) where.push(inArray(d.siteId, siteIds));
  if (siteId) where.push(eq(d.siteId, siteId));
  return where;
}

function inventoryWhere(p: InventoryScope): SQL[] {
  const where: SQL[] = [eq(sw.orgId, p.orgId), isNull(sw.removedAt), ...deviceScope(p.orgId, p.siteIds, p.siteId)];
  if (!p.system) where.push(eq(sw.isSystemComponent, false));
  if (p.platform?.length) where.push(inArray(d.platform, p.platform as (typeof d.$inferSelect.platform)[]));
  if (p.source?.length) where.push(inArray(sw.source, p.source as (typeof sw.$inferSelect.source)[]));
  if (p.publisher) where.push(ilike(sw.publisher, likePattern(p.publisher)));
  if (p.q) {
    const like = likePattern(p.q);
    where.push(or(ilike(sw.name, like), ilike(sw.publisher, like))!);
  }
  return where;
}

export interface InventoryRow {
  name: string; publisher: string | null; devices: number; versionCount: number; firstSeenAt: Date; lastSeenAt: Date; isSystemComponent: boolean; sources: string[]; platforms: string[]; totalBytes: number | null;
  versions: { version: string | null; devices: number }[];
}

/** Packages across the fleet, one row per name, with the version distribution for the page. */
export async function listSoftwareInventory(p: InventoryParams) {
  const db = await getDb();
  const where = inventoryWhere(p);
  const devicesExpr = sql<number>`count(distinct ${sw.deviceId})::int`;
  const versionsExpr = sql<number>`count(distinct coalesce(${sw.version}, ''))::int`;
  const sortExpr: SQL = p.sort === "name" ? sql`${sw.name}` : p.sort === "publisher" ? sql`min(${sw.publisher})` : p.sort === "versions" ? versionsExpr : p.sort === "firstSeenAt" ? sql`min(${sw.firstSeenAt})` : p.sort === "lastSeenAt" ? sql`max(${sw.lastSeenAt})` : devicesExpr;
  const dir = p.dir ?? (p.sort === "name" || p.sort === "publisher" ? "asc" : "desc");
  const [{ total }] = await db.select({ total: sql<number>`count(distinct ${sw.name})::int` }).from(sw).innerJoin(d, eq(d.id, sw.deviceId)).where(and(...where));
  const rows = await db
    .select({
      name: sw.name,
      publisher: sql<string | null>`min(${sw.publisher})`,
      devices: devicesExpr,
      versionCount: versionsExpr,
      firstSeenAt: sql<Date>`min(${sw.firstSeenAt})`,
      lastSeenAt: sql<Date>`max(${sw.lastSeenAt})`,
      isSystemComponent: sql<boolean>`bool_or(${sw.isSystemComponent})`,
      sources: sql<string[]>`jsonb_agg(distinct ${sw.source})`,
      platforms: sql<string[]>`jsonb_agg(distinct ${d.platform})`,
      totalBytes: sql<number | null>`sum(${sw.sizeBytes})::float8`,
    })
    .from(sw)
    .innerJoin(d, eq(d.id, sw.deviceId))
    .where(and(...where))
    .groupBy(sw.name)
    .orderBy(dir === "asc" ? asc(sortExpr) : desc(sortExpr), asc(sw.name))
    .limit(p.pageSize)
    .offset((p.page - 1) * p.pageSize);
  const names = rows.map((r) => r.name);
  const versions = names.length
    ? await db.select({ name: sw.name, version: sw.version, devices: sql<number>`count(distinct ${sw.deviceId})::int` }).from(sw).innerJoin(d, eq(d.id, sw.deviceId)).where(and(...where, inArray(sw.name, names))).groupBy(sw.name, sw.version).orderBy(desc(sql`count(distinct ${sw.deviceId})`), asc(sw.version))
    : [];
  const byName = new Map<string, InventoryRow["versions"]>();
  for (const v of versions) byName.set(v.name, [...(byName.get(v.name) ?? []), { version: v.version, devices: v.devices }]);
  const items: InventoryRow[] = rows.map((r) => ({ ...r, versions: byName.get(r.name) ?? [] }));
  return { items, total, page: p.page, pageSize: p.pageSize, pages: Math.max(1, Math.ceil(total / p.pageSize)) };
}

/** Every device that has `name` installed (the drill-down behind one inventory row). */
export async function softwareDevices(p: { orgId: string; name: string; siteIds?: string[]; version?: string | null }) {
  const db = await getDb();
  const where: SQL[] = [eq(sw.orgId, p.orgId), eq(sw.name, p.name), isNull(sw.removedAt), ...deviceScope(p.orgId, p.siteIds)];
  if (p.version !== undefined) where.push(p.version === null ? isNull(sw.version) : eq(sw.version, p.version));
  return db
    .select({
      id: sw.id, deviceId: sw.deviceId, deviceName: d.name, platform: d.platform, deviceStatus: d.status, siteId: d.siteId, loggedInUser: d.loggedInUser, osName: d.osName,
      version: sw.version, publisher: sw.publisher, source: sw.source, installDate: sw.installDate, sizeBytes: sw.sizeBytes, installLocation: sw.installLocation, uninstallString: sw.uninstallString, isSystemComponent: sw.isSystemComponent, firstSeenAt: sw.firstSeenAt, lastSeenAt: sw.lastSeenAt,
    })
    .from(sw)
    .innerJoin(d, eq(d.id, sw.deviceId))
    .where(and(...where))
    .orderBy(asc(d.name))
    .limit(5000);
}

export async function softwareSummary(orgId: string, siteIds?: string[]) {
  const db = await getDb();
  const scope = and(...deviceScope(orgId, siteIds));
  const [devices] = await db.select({ total: sql<number>`count(*)::int`, inventoried: sql<number>`count(*) filter (where ${d.lastInventoryAt} is not null)::int` }).from(d).where(scope);
  const [pk] = await db
    .select({
      packages: sql<number>`count(distinct ${sw.name}) filter (where not ${sw.isSystemComponent})::int`,
      systemComponents: sql<number>`count(distinct ${sw.name}) filter (where ${sw.isSystemComponent})::int`,
      publishers: sql<number>`count(distinct ${sw.publisher})::int`,
      installs: sql<number>`count(*)::int`,
      newLast7d: sql<number>`count(*) filter (where ${sw.firstSeenAt} > now() - interval '7 days')::int`,
    })
    .from(sw)
    .innerJoin(d, eq(d.id, sw.deviceId))
    .where(and(scope, eq(sw.orgId, orgId), isNull(sw.removedAt)));
  const watch = await watchlistMatches(orgId, siteIds, 1);
  return { devices: devices.total, inventoried: devices.inventoried, ...pk, watchlist: { entries: watch.length, hits: watch.reduce((a, w) => a + w.devices, 0) } };
}

/* ------------------------------------------------------------------ watchlist */

const watchlistKey = (orgId: string) => `software:watchlist:${orgId}`;

export async function getWatchlist(orgId: string): Promise<WatchlistEntry[]> {
  const v = await getSetting<{ entries?: WatchlistEntry[] }>(watchlistKey(orgId), {});
  return Array.isArray(v?.entries) ? v.entries : [];
}

export async function setWatchlist(orgId: string, entries: WatchlistEntry[]) {
  await setSetting(watchlistKey(orgId), { entries, updatedAt: new Date().toISOString() });
  bus.publish("software.watchlist.updated", { entries: entries.length }, { orgId });
  return entries;
}

export interface WatchlistMatch extends WatchlistEntry {
  devices: number;
  matches: { deviceId: string; deviceName: string; platform: string; deviceStatus: string; name: string; version: string | null; publisher: string | null; source: string; firstSeenAt: Date }[];
}

/** Watchlist entries with the devices currently carrying a matching package (the "unwanted software" insight). */
export async function watchlistMatches(orgId: string, siteIds?: string[], limitPerEntry = 200): Promise<WatchlistMatch[]> {
  const entries = await getWatchlist(orgId);
  if (!entries.length) return [];
  const db = await getDb();
  const out: WatchlistMatch[] = [];
  for (const e of entries) {
    const where: SQL[] = [eq(sw.orgId, orgId), isNull(sw.removedAt), ilike(sw.name, likePattern(e.pattern)), ...deviceScope(orgId, siteIds)];
    const [{ devices }] = await db.select({ devices: sql<number>`count(distinct ${sw.deviceId})::int` }).from(sw).innerJoin(d, eq(d.id, sw.deviceId)).where(and(...where));
    const matches = devices
      ? await db.select({ deviceId: sw.deviceId, deviceName: d.name, platform: d.platform, deviceStatus: d.status, name: sw.name, version: sw.version, publisher: sw.publisher, source: sw.source, firstSeenAt: sw.firstSeenAt }).from(sw).innerJoin(d, eq(d.id, sw.deviceId)).where(and(...where)).orderBy(desc(sw.firstSeenAt)).limit(limitPerEntry)
      : [];
    out.push({ ...e, devices, matches });
  }
  return out;
}

/* ------------------------------------------------------------------ targets & manager planning */

export interface TargetSpec { deviceIds?: string[]; groupId?: string; siteId?: string; all?: boolean }
export interface TargetDevice { id: string; name: string; platform: string; osName: string | null; status: string; siteId: string | null }

/** Resolve a target spec to visible devices (decommissioned excluded, membership site scope applied). */
export async function resolveScopedTargets(orgId: string, t: TargetSpec, siteIds?: string[]): Promise<TargetDevice[]> {
  const ids = new Set<string>();
  if (t.all) for (const id of await resolveTargets(orgId, "org", [], null)) ids.add(id);
  else {
    if (t.deviceIds?.length) for (const id of await resolveTargets(orgId, "device", t.deviceIds, null)) ids.add(id);
    if (t.groupId) for (const id of await resolveTargets(orgId, "group", [t.groupId], null)) ids.add(id);
    if (t.siteId) for (const id of await resolveTargets(orgId, "site", [t.siteId], null)) ids.add(id);
  }
  if (!ids.size) return [];
  const db = await getDb();
  const where: SQL[] = [eq(d.orgId, orgId), inArray(d.id, [...ids])];
  if (siteIds?.length) where.push(inArray(d.siteId, siteIds));
  return db.select({ id: d.id, name: d.name, platform: d.platform, osName: d.osName, status: d.status, siteId: d.siteId }).from(d).where(and(...where)).orderBy(asc(d.name));
}

const MANAGERS_BY_PLATFORM: Record<SoftwarePlatform, PackageManager[]> = {
  windows: ["winget", "choco", "msi", "exe", "msix", "url", "script"],
  linux: ["apt", "dnf", "snap", "flatpak", "url", "script"],
  macos: ["brew", "brew_cask", "pkg", "dmg", "url", "script"],
};
export function platformOf(device: Pick<TargetDevice, "platform">): SoftwarePlatform | null {
  return device.platform === "windows" || device.platform === "linux" || device.platform === "macos" ? device.platform : null;
}
export function managerSupported(platform: SoftwarePlatform, manager: PackageManager): boolean {
  return MANAGERS_BY_PLATFORM[platform].includes(manager);
}
/** Default package manager for a device when the caller did not pick one. */
export function defaultManager(device: Pick<TargetDevice, "platform" | "osName">): PackageManager | null {
  const platform = platformOf(device);
  if (!platform) return null;
  if (platform === "windows") return "winget";
  if (platform === "macos") return "brew";
  return /fedora|red hat|rhel|centos|rocky|alma|oracle|amazon|suse/i.test(device.osName ?? "") ? "dnf" : "apt";
}
/** Inventory source -> manager that can remove it. */
export function managerForSource(source: string, platform: string): PackageManager | null {
  switch (source) {
    case "winget": case "store": return "winget";
    case "choco": return "choco";
    case "apt": return "apt";
    case "dnf": case "rpm": return "dnf";
    case "snap": return "snap";
    case "flatpak": return "flatpak";
    case "brew": case "pkg": case "app": return platform === "macos" ? "brew" : null;
    default: return null;
  }
}

export interface JobGroup { key: string; payload: Record<string, unknown>; deviceIds: string[]; label: string }

/**
 * Plan "uninstall `name` everywhere": one job per distinct payload. Package-manager installs share one job per
 * manager; Windows entries with their own uninstaller string get one job each (the string differs per device).
 */
export async function uninstallPlan(orgId: string, name: string, deviceIds: string[] | undefined, siteIds?: string[]) {
  const rows = await softwareDevices({ orgId, name, siteIds });
  const wanted = deviceIds?.length ? new Set(deviceIds) : null;
  const groups = new Map<string, JobGroup>();
  const skipped: { deviceId: string; deviceName: string; reason: string }[] = [];
  for (const r of rows) {
    if (wanted && !wanted.has(r.deviceId)) continue;
    if (r.isSystemComponent) { skipped.push({ deviceId: r.deviceId, deviceName: r.deviceName, reason: "system component" }); continue; }
    let payload: Record<string, unknown>;
    if (r.platform === "windows" && r.uninstallString) payload = { name, uninstallString: r.uninstallString, installLocation: r.installLocation ?? undefined, deviceId: r.deviceId };
    else {
      const manager = managerForSource(r.source, r.platform);
      if (!manager && r.platform !== "windows") { skipped.push({ deviceId: r.deviceId, deviceName: r.deviceName, reason: `no uninstaller known for source "${r.source}"` }); continue; }
      payload = { name, manager: manager ?? undefined, package: name };
    }
    const key = JSON.stringify(payload);
    const g = groups.get(key) ?? { key, payload, deviceIds: [], label: payload.uninstallString ? `${r.deviceName}` : String(payload.manager ?? "winget") };
    g.deviceIds.push(r.deviceId);
    groups.set(key, g);
  }
  return { groups: [...groups.values()], skipped, matched: rows.length };
}

/** Plan an install across mixed platforms: one job per (manager, payload) with devices that support it. */
export function installPlan(devices: TargetDevice[], spec: { manager?: PackageManager; package?: string; version?: string; url?: string; sha256?: string; args?: string; name?: string }) {
  const groups = new Map<string, JobGroup>();
  const skipped: { deviceId: string; deviceName: string; reason: string }[] = [];
  for (const dev of devices) {
    const platform = platformOf(dev);
    if (!platform) { skipped.push({ deviceId: dev.id, deviceName: dev.name, reason: `unsupported platform ${dev.platform}` }); continue; }
    const manager = spec.manager ?? defaultManager(dev);
    if (!manager || !managerSupported(platform, manager)) { skipped.push({ deviceId: dev.id, deviceName: dev.name, reason: `${manager ?? "no manager"} is not available on ${platform}` }); continue; }
    if (["msi", "exe", "pkg", "url", "dmg", "msix"].includes(manager) && !spec.url) { skipped.push({ deviceId: dev.id, deviceName: dev.name, reason: `${manager} needs a download url` }); continue; }
    if (!["msi", "exe", "pkg", "url", "dmg", "msix"].includes(manager) && !spec.package) { skipped.push({ deviceId: dev.id, deviceName: dev.name, reason: `${manager} needs a package id` }); continue; }
    const payload = { manager, package: spec.package, version: spec.version, url: spec.url, sha256: spec.sha256, args: spec.args, name: spec.name ?? spec.package ?? spec.url };
    const key = JSON.stringify(payload);
    const g = groups.get(key) ?? { key, payload, deviceIds: [], label: manager };
    g.deviceIds.push(dev.id);
    groups.set(key, g);
  }
  return { groups: [...groups.values()], skipped };
}
