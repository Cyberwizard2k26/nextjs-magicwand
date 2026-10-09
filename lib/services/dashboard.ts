/** Dashboard overview: one round of cheap aggregate queries scoped to the active org. */
import { and, desc, eq, inArray, isNotNull, lt, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";

export interface DashboardOverview {
  devices: {
    total: number;
    byStatus: Record<string, number>;
    byPlatform: { platform: string; count: number }[];
    avgHealth: number | null;
    pendingReboot: number;
    unhealthy: { id: string; name: string; platform: string; status: string; healthScore: number | null }[];
    recentlyOffline: { id: string; name: string; platform: string; lastSeenAt: string | null }[];
  };
  alerts: null | { open: number; bySeverity: Record<string, number>; recent: { id: string; title: string; severity: string; deviceId: string | null; deviceName: string | null; openedAt: string; occurrences: number }[] };
  tickets: null | { open: number };
}

export async function getDashboardOverview(orgId: string, opts: { devices: boolean; alerts: boolean; tickets: boolean; siteIds?: string[] }): Promise<DashboardOverview> {
  const db = await getDb();
  const d = schema.devices;
  // Without devices.view the device aggregates are not loaded at all (scope matches nothing).
  const scope = opts.devices ? and(eq(d.orgId, orgId), sql`${d.status} <> 'decommissioned'`, opts.siteIds?.length ? inArray(d.siteId, opts.siteIds) : undefined) : sql`false`;

  const [statusRows, platformRows, [agg], unhealthy, recentlyOffline] = await Promise.all([
    db.select({ status: d.status, n: sql<number>`count(*)::int` }).from(d).where(scope).groupBy(d.status),
    db.select({ platform: d.platform, n: sql<number>`count(*)::int` }).from(d).where(scope).groupBy(d.platform).orderBy(desc(sql`count(*)`)),
    db.select({ avgHealth: sql<number | null>`round(avg(${d.healthScore}))::int`, pendingReboot: sql<number>`count(*) filter (where ${d.pendingReboot})::int` }).from(d).where(scope),
    db.select({ id: d.id, name: d.name, platform: d.platform, status: d.status, healthScore: d.healthScore }).from(d).where(and(scope, isNotNull(d.healthScore), lt(d.healthScore, 70))).orderBy(d.healthScore).limit(5),
    db.select({ id: d.id, name: d.name, platform: d.platform, lastSeenAt: d.lastSeenAt }).from(d).where(and(scope, eq(d.status, "offline"))).orderBy(sql`${d.lastSeenAt} desc nulls last`).limit(5),
  ]);

  const byStatus: Record<string, number> = {};
  for (const r of statusRows) byStatus[r.status] = r.n;

  let alerts: DashboardOverview["alerts"] = null;
  if (opts.alerts) {
    const a = schema.alerts;
    const open = and(eq(a.orgId, orgId), eq(a.status, "open"));
    const [sevRows, recent] = await Promise.all([
      db.select({ severity: a.severity, n: sql<number>`count(*)::int` }).from(a).where(open).groupBy(a.severity),
      db
        .select({ id: a.id, title: a.title, severity: a.severity, deviceId: a.deviceId, deviceName: d.name, openedAt: a.openedAt, occurrences: a.occurrences })
        .from(a)
        .leftJoin(d, eq(d.id, a.deviceId))
        .where(open)
        .orderBy(sql`case ${a.severity} when 'critical' then 0 when 'high' then 1 when 'medium' then 2 when 'low' then 3 else 4 end`, desc(a.openedAt))
        .limit(6),
    ]);
    const bySeverity: Record<string, number> = {};
    for (const r of sevRows) bySeverity[r.severity] = r.n;
    alerts = {
      open: sevRows.reduce((s, r) => s + r.n, 0),
      bySeverity,
      recent: recent.map((r) => ({ ...r, openedAt: iso(r.openedAt)! })),
    };
  }

  let tickets: DashboardOverview["tickets"] = null;
  if (opts.tickets) {
    const t = schema.tickets;
    const [row] = await db.select({ n: sql<number>`count(*)::int` }).from(t).where(and(eq(t.orgId, orgId), inArray(t.status, ["new", "open"])));
    tickets = { open: row.n };
  }

  return {
    devices: {
      total: statusRows.reduce((s, r) => s + r.n, 0),
      byStatus,
      byPlatform: platformRows.map((r) => ({ platform: r.platform, count: r.n })),
      avgHealth: agg?.avgHealth ?? null,
      pendingReboot: agg?.pendingReboot ?? 0,
      unhealthy,
      recentlyOffline: recentlyOffline.map((r) => ({ ...r, lastSeenAt: iso(r.lastSeenAt) })),
    },
    alerts,
    tickets,
  };
}

function iso(v: Date | string | null | undefined): string | null {
  if (!v) return null;
  return typeof v === "string" ? v : v.toISOString();
}
