/**
 * Aggregates behind the Access console's session-group tree (GET /api/v1/devices/tree) and the paginated lists of
 * its "virtual" groups (outdated agents, host connected, recently accessed, needs attention) that the plain device
 * filters cannot express. Version ordering lives in lib/client/agent-version.ts so the browser can reuse it.
 */
import { and, asc, desc, eq, ilike, inArray, isNull, or, sql, type SQL } from "drizzle-orm";
import { getDb, schema } from "../db";
import { agentRegistry } from "../realtime/agent-registry";
import type { DeviceTreeResponse, VirtualGroup } from "../api/contracts/device-notes";
import { compareVersions, isOutdated, newestVersion } from "../client/agent-version";

export { compareVersions, isOutdated, newestVersion };

/* ------------------------------------------------------------------ tree aggregate */

const RECENT_WINDOW = sql`now() - interval '24 hours'`;
const LIVE_SESSION_STATUSES = ["requested", "pending_consent", "active"] as const;

function scopeWhere(orgId: string, siteIds?: string[]): SQL[] {
  const where: SQL[] = [eq(schema.devices.orgId, orgId), sql`${schema.devices.status} <> 'decommissioned'`];
  if (siteIds?.length) where.push(inArray(schema.devices.siteId, siteIds));
  return where;
}

export async function deviceTree(orgId: string, siteIds?: string[]): Promise<DeviceTreeResponse> {
  const db = await getDb();
  const scope = and(...scopeWhere(orgId, siteIds));
  const d = schema.devices;

  const [facets, tagRows, groupRows, siteRows, versionRows, hostRows, recentRow, alertRows, telemetryRows] = await Promise.all([
    db.select({ siteId: d.siteId, platform: d.platform, deviceType: d.deviceType, status: d.status, pendingReboot: d.pendingReboot, n: sql<number>`count(*)::int` }).from(d).where(scope).groupBy(d.siteId, d.platform, d.deviceType, d.status, d.pendingReboot),
    db.execute<{ tag: string; status: string; n: number }>(sql`select t.tag as tag, ${d.status} as status, count(*)::int as n from ${d}, jsonb_array_elements_text(${d.tags}) as t(tag) where ${scope} group by t.tag, ${d.status}`),
    db.select({ id: schema.deviceGroups.id, name: schema.deviceGroups.name, color: schema.deviceGroups.color, isDynamic: schema.deviceGroups.isDynamic, total: sql<number>`(select count(*)::int from ${d} where ${d.groupId} = ${schema.deviceGroups.id} and ${d.orgId} = ${orgId} and ${d.status} <> 'decommissioned')`, online: sql<number>`(select count(*)::int from ${d} where ${d.groupId} = ${schema.deviceGroups.id} and ${d.orgId} = ${orgId} and ${d.status} = 'online')` }).from(schema.deviceGroups).where(eq(schema.deviceGroups.orgId, orgId)).orderBy(schema.deviceGroups.sortOrder, schema.deviceGroups.name),
    db.select({ id: schema.sites.id, name: schema.sites.name }).from(schema.sites).where(and(eq(schema.sites.orgId, orgId), siteIds?.length ? inArray(schema.sites.id, siteIds) : undefined)).orderBy(schema.sites.name),
    db.select({ version: d.agentVersion, n: sql<number>`count(*)::int` }).from(d).where(and(scope, sql`${d.agentVersion} is not null`)).groupBy(d.agentVersion),
    db.select({ deviceId: schema.remoteSessions.deviceId }).from(schema.remoteSessions).innerJoin(d, eq(d.id, schema.remoteSessions.deviceId)).where(and(scope, eq(schema.remoteSessions.orgId, orgId), inArray(schema.remoteSessions.status, [...LIVE_SESSION_STATUSES]))).groupBy(schema.remoteSessions.deviceId),
    db.select({ n: sql<number>`count(*)::int` }).from(d).where(and(scope, recentCondition())),
    db.select({ siteId: d.siteId, n: sql<number>`count(*)::int` }).from(schema.alerts).innerJoin(d, eq(d.id, schema.alerts.deviceId)).where(and(scope, eq(schema.alerts.orgId, orgId), inArray(schema.alerts.status, ["open", "acknowledged"]))).groupBy(d.siteId),
    db.execute<{ device_id: string; ts: string | Date; cpu_percent: number | null; mem_used_bytes: number | string | null; mem_total_bytes: number | string | null }>(sql`
      select distinct on (t.device_id) t.device_id, t.ts, t.cpu_percent, t.mem_used_bytes, t.mem_total_bytes
      from ${schema.telemetry} t
      where t.device_id in (select ${d.id} from ${d} where ${scope} and ${d.status} = 'online' limit 500)
        and t.ts > now() - interval '15 minutes'
      order by t.device_id, t.ts desc`),
  ]);

  const totals = { all: 0, online: 0, offline: 0, pending: 0, maintenance: 0 };
  const bySite = new Map<string | null, { total: number; online: number }>();
  const byPlatform = new Map<string, { total: number; online: number }>();
  const byType = new Map<string, { total: number; online: number }>();
  let pendingReboot = 0;
  const bump = <K,>(m: Map<K, { total: number; online: number }>, k: K, n: number, online: boolean) => {
    const cur = m.get(k) ?? { total: 0, online: 0 };
    cur.total += n;
    if (online) cur.online += n;
    m.set(k, cur);
  };
  for (const f of facets) {
    const online = f.status === "online";
    totals.all += f.n;
    if (f.status === "online") totals.online += f.n;
    else if (f.status === "offline") totals.offline += f.n;
    else if (f.status === "pending") totals.pending += f.n;
    else if (f.status === "maintenance") totals.maintenance += f.n;
    if (f.pendingReboot) pendingReboot += f.n;
    bump(bySite, f.siteId, f.n, online);
    bump(byPlatform, f.platform, f.n, online);
    bump(byType, f.deviceType, f.n, online);
  }
  const alertsBySite = new Map<string | null, number>();
  let openAlerts = 0;
  for (const a of alertRows) { alertsBySite.set(a.siteId, (alertsBySite.get(a.siteId) ?? 0) + a.n); openAlerts += a.n; }

  const tags = new Map<string, { total: number; online: number }>();
  for (const t of rows(tagRows)) bump(tags, t.tag, Number(t.n), t.status === "online");

  const versions = versionRows.filter((v) => v.version).map((v) => ({ version: v.version as string, count: v.n })).sort((a, b) => compareVersions(b.version, a.version));
  const newest = newestVersion(versions.map((v) => v.version));
  const outdatedTotal = versions.filter((v) => isOutdated(v.version, newest)).reduce((s, v) => s + v.count, 0);

  const live: DeviceTreeResponse["live"] = {};
  for (const t of rows(telemetryRows)) {
    const used = t.mem_used_bytes === null ? null : Number(t.mem_used_bytes);
    const total = t.mem_total_bytes === null ? null : Number(t.mem_total_bytes);
    live[t.device_id] = { cpuPercent: t.cpu_percent === null ? null : Math.round(Number(t.cpu_percent)), memPercent: used !== null && total ? Math.round((used / total) * 100) : null, ts: new Date(t.ts).toISOString() };
  }

  // Devices whose agent is connected to this node but whose live session rows have not been written yet still count as connected.
  const hostIds = new Set(hostRows.map((h) => h.deviceId));

  return {
    totals,
    sites: siteRows.map((s) => ({ id: s.id, name: s.name, total: bySite.get(s.id)?.total ?? 0, online: bySite.get(s.id)?.online ?? 0, openAlerts: alertsBySite.get(s.id) ?? 0 })),
    unassigned: bySite.get(null) ?? { total: 0, online: 0 },
    platforms: [...byPlatform.entries()].map(([platform, c]) => ({ platform, ...c })).sort((a, b) => b.total - a.total || a.platform.localeCompare(b.platform)),
    deviceTypes: [...byType.entries()].map(([type, c]) => ({ type, ...c })).sort((a, b) => b.total - a.total || a.type.localeCompare(b.type)),
    groups: groupRows.map((g) => ({ id: g.id, name: g.name, color: g.color, isDynamic: g.isDynamic, total: g.total, online: g.online })),
    tags: [...tags.entries()].map(([tag, c]) => ({ tag, ...c })).sort((a, b) => b.total - a.total || a.tag.localeCompare(b.tag)).slice(0, 100),
    outdated: { total: outdatedTotal, newestAgentVersion: newest, versions },
    hostConnected: { total: hostIds.size, deviceIds: [...hostIds] },
    recent: { total: recentRow[0]?.n ?? 0 },
    attention: { total: openAlerts + pendingReboot, openAlerts, pendingReboot },
    live,
    generatedAt: new Date().toISOString(),
  };
}

/** Rows from db.execute() differ between the pg and PGlite drivers; normalise to an array. */
function rows<T>(res: unknown): T[] {
  if (Array.isArray(res)) return res as T[];
  const r = res as { rows?: T[] };
  return r?.rows ?? [];
}

function recentCondition(): SQL {
  const d = schema.devices;
  return sql`(
    exists (select 1 from ${schema.remoteSessions} rs where rs.device_id = ${d.id} and rs.started_at > ${RECENT_WINDOW})
    or exists (select 1 from ${schema.jobRuns} jr where jr.device_id = ${d.id} and jr.created_at > ${RECENT_WINDOW})
  )`;
}

/* ------------------------------------------------------------------ virtual group lists */

export interface VirtualListParams {
  orgId: string;
  list: VirtualGroup;
  siteIds?: string[];
  q?: string;
  status?: string[];
  platform?: string[];
  sort?: string;
  dir?: "asc" | "desc";
  page: number;
  pageSize: number;
}

const SORTABLE: Record<string, SQL | typeof schema.devices.name> = {
  name: schema.devices.name,
  lastSeenAt: sql`${schema.devices.lastSeenAt}`,
  healthScore: sql`${schema.devices.healthScore}`,
  status: sql`${schema.devices.status}`,
  loggedInUser: sql`${schema.devices.loggedInUser}`,
  osName: sql`${schema.devices.osName}`,
};

/** Paginated devices of one virtual group, in the same row shape as GET /api/v1/devices plus `agentOutdated` and `liveSessions`. */
export async function listVirtualGroup(p: VirtualListParams) {
  const db = await getDb();
  const d = schema.devices;
  const where = scopeWhere(p.orgId, p.siteIds);
  if (p.status?.length) where.push(inArray(d.status, p.status as (typeof d.$inferSelect.status)[]));
  if (p.platform?.length) where.push(inArray(d.platform, p.platform as (typeof d.$inferSelect.platform)[]));
  if (p.q) {
    const like = `%${p.q.replace(/[%_]/g, "\\$&")}%`;
    where.push(or(ilike(d.name, like), ilike(d.hostname, like), ilike(d.displayName, like), ilike(d.loggedInUser, like), ilike(d.serialNumber, like), ilike(d.publicIp, like), sql`${d.localIps}::text ilike ${like}`, sql`${d.tags}::text ilike ${like}`)!);
  }

  let newest: string | null = null;
  switch (p.list) {
    case "outdated": {
      const versionRows = await db.select({ version: d.agentVersion }).from(d).where(and(...scopeWhere(p.orgId, p.siteIds), sql`${d.agentVersion} is not null`)).groupBy(d.agentVersion);
      newest = newestVersion(versionRows.map((v) => v.version));
      if (!newest) return empty(p);
      where.push(sql`${d.agentVersion} is not null and ${d.agentVersion} <> ${newest}`);
      break;
    }
    case "host_connected":
      where.push(sql`exists (select 1 from ${schema.remoteSessions} rs where rs.device_id = ${d.id} and rs.status in ('requested','pending_consent','active'))`);
      break;
    case "recent":
      where.push(recentCondition());
      break;
    case "attention":
      where.push(sql`(${d.pendingReboot} or exists (select 1 from ${schema.alerts} a where a.device_id = ${d.id} and a.status in ('open','acknowledged')))`);
      break;
    case "unassigned":
      where.push(isNull(d.siteId));
      break;
  }

  const sortCol = SORTABLE[p.sort ?? ""] ?? d.name;
  const order = p.dir === "desc" ? desc(sortCol) : asc(sortCol);
  const [{ total }] = await db.select({ total: sql<number>`count(*)::int` }).from(d).where(and(...where));
  const items = await db
    .select({
      id: d.id, name: d.name, displayName: d.displayName, hostname: d.hostname, platform: d.platform, deviceType: d.deviceType, osName: d.osName, osVersion: d.osVersion, status: d.status,
      lastSeenAt: d.lastSeenAt, lastBootAt: d.lastBootAt, publicIp: d.publicIp, localIps: d.localIps, loggedInUser: d.loggedInUser, siteId: d.siteId, groupId: d.groupId, tags: d.tags, healthScore: d.healthScore,
      agentVersion: d.agentVersion, pendingReboot: d.pendingReboot, manufacturer: d.manufacturer, model: d.model, serialNumber: d.serialNumber, cpuModel: d.cpuModel, memoryBytes: d.memoryBytes, isProbe: d.isProbe, isAgentless: d.isAgentless, location: d.location,
      siteName: schema.sites.name, groupName: schema.deviceGroups.name,
      openAlerts: sql<number>`(select count(*)::int from ${schema.alerts} a where a.device_id = ${d.id} and a.status = 'open')`,
      liveSessions: sql<number>`(select count(*)::int from ${schema.remoteSessions} rs where rs.device_id = ${d.id} and rs.status in ('requested','pending_consent','active'))`,
    })
    .from(d)
    .leftJoin(schema.sites, eq(schema.sites.id, d.siteId))
    .leftJoin(schema.deviceGroups, eq(schema.deviceGroups.id, d.groupId))
    .where(and(...where))
    .orderBy(order, asc(d.id))
    .limit(p.pageSize)
    .offset((p.page - 1) * p.pageSize);
  return {
    items: items.map((r) => ({ ...r, connected: agentRegistry.isOnline(r.id), agentOutdated: p.list === "outdated" ? true : isOutdated(r.agentVersion, newest) })),
    total,
    page: p.page,
    pageSize: p.pageSize,
    pages: Math.max(1, Math.ceil(total / p.pageSize)),
    list: p.list,
  };
}

function empty(p: VirtualListParams) {
  return { items: [], total: 0, page: p.page, pageSize: p.pageSize, pages: 1, list: p.list };
}
