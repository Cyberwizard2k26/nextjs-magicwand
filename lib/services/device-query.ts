/** Shared device listing used by the REST API, the command palette and exports. */
import { and, asc, desc, eq, ilike, inArray, or, sql, type SQL } from "drizzle-orm";
import { getDb, schema } from "../db";
import { agentRegistry } from "../realtime/agent-registry";

export interface DeviceListParams {
  orgId: string;
  q?: string;
  status?: string[];
  platform?: string[];
  siteId?: string;
  groupId?: string;
  tag?: string;
  deviceType?: string[];
  healthBelow?: number;
  sort?: string;
  dir?: "asc" | "desc";
  page: number;
  pageSize: number;
  siteIds?: string[]; // membership scope
}

const SORTABLE: Record<string, typeof schema.devices.name> = {
  name: schema.devices.name,
  hostname: schema.devices.hostname as unknown as typeof schema.devices.name,
  status: schema.devices.status as unknown as typeof schema.devices.name,
  platform: schema.devices.platform as unknown as typeof schema.devices.name,
  lastSeenAt: schema.devices.lastSeenAt as unknown as typeof schema.devices.name,
  healthScore: schema.devices.healthScore as unknown as typeof schema.devices.name,
  osName: schema.devices.osName as unknown as typeof schema.devices.name,
  loggedInUser: schema.devices.loggedInUser as unknown as typeof schema.devices.name,
  createdAt: schema.devices.createdAt as unknown as typeof schema.devices.name,
};

export async function listDevices(p: DeviceListParams) {
  const db = await getDb();
  const where: SQL[] = [eq(schema.devices.orgId, p.orgId)];
  if (p.siteIds?.length) where.push(inArray(schema.devices.siteId, p.siteIds));
  if (p.status?.length) where.push(inArray(schema.devices.status, p.status as (typeof schema.devices.$inferSelect.status)[]));
  else where.push(sql`${schema.devices.status} <> 'decommissioned'`);
  if (p.platform?.length) where.push(inArray(schema.devices.platform, p.platform as (typeof schema.devices.$inferSelect.platform)[]));
  if (p.deviceType?.length) where.push(inArray(schema.devices.deviceType, p.deviceType as (typeof schema.devices.$inferSelect.deviceType)[]));
  if (p.siteId) where.push(eq(schema.devices.siteId, p.siteId));
  if (p.groupId) where.push(eq(schema.devices.groupId, p.groupId));
  if (p.tag) where.push(sql`${schema.devices.tags} @> ${JSON.stringify([p.tag])}::jsonb`);
  if (p.healthBelow !== undefined) where.push(sql`${schema.devices.healthScore} < ${p.healthBelow}`);
  if (p.q) {
    const like = `%${p.q.replace(/[%_]/g, "\\$&")}%`;
    where.push(or(ilike(schema.devices.name, like), ilike(schema.devices.hostname, like), ilike(schema.devices.displayName, like), ilike(schema.devices.loggedInUser, like), ilike(schema.devices.serialNumber, like), ilike(schema.devices.publicIp, like), sql`${schema.devices.localIps}::text ilike ${like}`, sql`${schema.devices.tags}::text ilike ${like}`)!);
  }
  const sortCol = SORTABLE[p.sort ?? ""] ?? schema.devices.name;
  const order = p.dir === "desc" ? desc(sortCol) : asc(sortCol);
  const [{ total }] = await db.select({ total: sql<number>`count(*)::int` }).from(schema.devices).where(and(...where));
  const rows = await db
    .select({
      id: schema.devices.id,
      name: schema.devices.name,
      displayName: schema.devices.displayName,
      hostname: schema.devices.hostname,
      platform: schema.devices.platform,
      deviceType: schema.devices.deviceType,
      osName: schema.devices.osName,
      osVersion: schema.devices.osVersion,
      status: schema.devices.status,
      lastSeenAt: schema.devices.lastSeenAt,
      lastBootAt: schema.devices.lastBootAt,
      publicIp: schema.devices.publicIp,
      localIps: schema.devices.localIps,
      loggedInUser: schema.devices.loggedInUser,
      siteId: schema.devices.siteId,
      groupId: schema.devices.groupId,
      tags: schema.devices.tags,
      healthScore: schema.devices.healthScore,
      agentVersion: schema.devices.agentVersion,
      pendingReboot: schema.devices.pendingReboot,
      manufacturer: schema.devices.manufacturer,
      model: schema.devices.model,
      serialNumber: schema.devices.serialNumber,
      cpuModel: schema.devices.cpuModel,
      memoryBytes: schema.devices.memoryBytes,
      isProbe: schema.devices.isProbe,
      isAgentless: schema.devices.isAgentless,
      location: schema.devices.location,
      siteName: schema.sites.name,
      groupName: schema.deviceGroups.name,
      openAlerts: sql<number>`(select count(*)::int from ${schema.alerts} a where a.device_id = ${schema.devices.id} and a.status = 'open')`,
    })
    .from(schema.devices)
    .leftJoin(schema.sites, eq(schema.sites.id, schema.devices.siteId))
    .leftJoin(schema.deviceGroups, eq(schema.deviceGroups.id, schema.devices.groupId))
    .where(and(...where))
    .orderBy(order, asc(schema.devices.id))
    .limit(p.pageSize)
    .offset((p.page - 1) * p.pageSize);
  return { items: rows.map((r) => ({ ...r, connected: agentRegistry.isOnline(r.id) })), total, page: p.page, pageSize: p.pageSize, pages: Math.max(1, Math.ceil(total / p.pageSize)) };
}
