/**
 * Device groups: a tree of static groups (explicit members) and dynamic groups (a DeviceFilter evaluated live).
 * Counting and previews reuse the filter semantics in device-filter.ts so jobs, policies and groups agree.
 */
import { and, asc, eq, ilike, inArray, sql } from "drizzle-orm";
import { getDb, schema } from "../db";
import { bus } from "../bus";
import { evalFilter } from "./device-filter";
import type { DeviceFilter } from "../db/schema/devices";
import type { GroupCreateT, GroupPatchT, DeviceFilterT } from "../api/contracts/groups";
import { ServiceError } from "./org";

export type DeviceGroup = typeof schema.deviceGroups.$inferSelect;
type DeviceRow = typeof schema.devices.$inferSelect;

/** Fields the dynamic-group filter builder offers, with the operators that make sense for each. */
export const FILTER_FIELDS: { field: string; label: string; type: "string" | "number" | "boolean" | "enum" | "array"; values?: string[] }[] = [
  { field: "name", label: "Name", type: "string" },
  { field: "hostname", label: "Hostname", type: "string" },
  { field: "platform", label: "Platform", type: "enum", values: ["windows", "linux", "macos", "freebsd", "android", "ios", "network", "other"] },
  { field: "deviceType", label: "Device type", type: "enum", values: ["workstation", "laptop", "server", "vm", "network", "printer", "mobile", "iot", "other"] },
  { field: "status", label: "Status", type: "enum", values: ["online", "offline", "maintenance", "pending"] },
  { field: "osName", label: "OS name", type: "string" },
  { field: "osVersion", label: "OS version", type: "string" },
  { field: "arch", label: "Architecture", type: "string" },
  { field: "siteId", label: "Site", type: "string" },
  { field: "tags", label: "Tags", type: "array" },
  { field: "loggedInUser", label: "Signed-in user", type: "string" },
  { field: "manufacturer", label: "Manufacturer", type: "string" },
  { field: "model", label: "Model", type: "string" },
  { field: "domain", label: "Domain", type: "string" },
  { field: "agentVersion", label: "Agent version", type: "string" },
  { field: "healthScore", label: "Health score", type: "number" },
  { field: "cpuCores", label: "CPU cores", type: "number" },
  { field: "memoryBytes", label: "Memory (bytes)", type: "number" },
  { field: "pendingReboot", label: "Pending reboot", type: "boolean" },
  { field: "isProbe", label: "Network probe", type: "boolean" },
  { field: "publicIp", label: "Public IP", type: "string" },
  { field: "serialNumber", label: "Serial number", type: "string" },
  { field: "facts.virtualization.isVm", label: "Is virtual machine", type: "boolean" },
  { field: "customFields.*", label: "Custom field (customFields.<key>)", type: "string" },
];

const ACTIVE = sql`${schema.devices.status} <> 'decommissioned'`;

async function activeDevices(orgId: string, siteIds?: string[]): Promise<DeviceRow[]> {
  const db = await getDb();
  return db.select().from(schema.devices).where(and(eq(schema.devices.orgId, orgId), ACTIVE, siteIds?.length ? inArray(schema.devices.siteId, siteIds) : undefined));
}

/** Device ids of a static group: primary group assignment plus explicit members. */
async function staticMemberIds(groupIds: string[]): Promise<Map<string, Set<string>>> {
  const db = await getDb();
  const out = new Map<string, Set<string>>(groupIds.map((g) => [g, new Set<string>()]));
  if (!groupIds.length) return out;
  for (const r of await db.select({ id: schema.devices.id, groupId: schema.devices.groupId }).from(schema.devices).where(and(inArray(schema.devices.groupId, groupIds), ACTIVE))) out.get(r.groupId!)?.add(r.id);
  for (const r of await db.select().from(schema.deviceGroupMembers).where(inArray(schema.deviceGroupMembers.groupId, groupIds))) out.get(r.groupId)?.add(r.deviceId);
  return out;
}

export interface GroupNode extends DeviceGroup { siteName: string | null; deviceCount: number; onlineCount: number; depth: number }

/** All groups of the org as a depth-first ordered tree (parents before children, siblings by sortOrder then name). */
export async function listGroups(orgId: string, opts: { q?: string; siteId?: string; siteIds?: string[] } = {}): Promise<GroupNode[]> {
  const db = await getDb();
  const rows = await db.select({ group: schema.deviceGroups, siteName: schema.sites.name }).from(schema.deviceGroups).leftJoin(schema.sites, eq(schema.sites.id, schema.deviceGroups.siteId)).where(eq(schema.deviceGroups.orgId, orgId)).orderBy(asc(schema.deviceGroups.sortOrder), asc(schema.deviceGroups.name));
  const devices = await activeDevices(orgId, opts.siteIds);
  const online = new Set(devices.filter((d) => d.status === "online").map((d) => d.id));
  const visible = new Set(devices.map((d) => d.id));
  const statics = await staticMemberIds(rows.filter((r) => !r.group.isDynamic).map((r) => r.group.id));
  const counted = rows.map(({ group, siteName }) => {
    let ids: string[];
    if (group.isDynamic) ids = devices.filter((d) => evalFilter(d as unknown as Record<string, unknown>, group.filter)).map((d) => d.id);
    else ids = [...(statics.get(group.id) ?? [])].filter((id) => visible.has(id));
    return { ...group, siteName, deviceCount: ids.length, onlineCount: ids.filter((id) => online.has(id)).length, depth: 0 };
  });
  // Depth-first ordering.
  const byParent = new Map<string | null, typeof counted>();
  const ids = new Set(counted.map((g) => g.id));
  for (const g of counted) {
    const parent = g.parentId && ids.has(g.parentId) ? g.parentId : null;
    if (!byParent.has(parent)) byParent.set(parent, []);
    byParent.get(parent)!.push(g);
  }
  const out: GroupNode[] = [];
  const walk = (parent: string | null, depth: number) => {
    for (const g of byParent.get(parent) ?? []) { out.push({ ...g, depth }); walk(g.id, depth + 1); }
  };
  walk(null, 0);
  let result = out;
  if (opts.siteId) result = result.filter((g) => g.siteId === opts.siteId || g.siteId === null);
  if (opts.q) { const q = opts.q.toLowerCase(); result = result.filter((g) => g.name.toLowerCase().includes(q) || (g.description ?? "").toLowerCase().includes(q)); }
  return result;
}

export async function getGroup(orgId: string, id: string) {
  const all = await listGroups(orgId);
  const g = all.find((x) => x.id === id);
  if (!g) return null;
  const children = all.filter((x) => x.parentId === id).map((x) => ({ id: x.id, name: x.name, isDynamic: x.isDynamic, deviceCount: x.deviceCount }));
  return { ...g, children };
}

const shapeDevice = (d: DeviceRow) => ({ id: d.id, name: d.name, hostname: d.hostname, platform: d.platform, deviceType: d.deviceType, status: d.status, osName: d.osName, siteId: d.siteId, lastSeenAt: d.lastSeenAt, loggedInUser: d.loggedInUser, tags: d.tags });

/** Devices in a group (members for static groups, live evaluation for dynamic ones), paginated. */
export async function listGroupDevices(orgId: string, id: string, p: { page: number; pageSize: number; siteIds?: string[]; q?: string }) {
  const db = await getDb();
  const [group] = await db.select().from(schema.deviceGroups).where(and(eq(schema.deviceGroups.orgId, orgId), eq(schema.deviceGroups.id, id)));
  if (!group) return null;
  const devices = await activeDevices(orgId, p.siteIds);
  let rows: DeviceRow[];
  if (group.isDynamic) rows = devices.filter((d) => evalFilter(d as unknown as Record<string, unknown>, group.filter));
  else { const ids = (await staticMemberIds([id])).get(id)!; rows = devices.filter((d) => ids.has(d.id)); }
  if (p.q) { const q = p.q.toLowerCase(); rows = rows.filter((d) => d.name.toLowerCase().includes(q) || (d.hostname ?? "").toLowerCase().includes(q)); }
  rows.sort((a, b) => a.name.localeCompare(b.name));
  const total = rows.length;
  return { items: rows.slice((p.page - 1) * p.pageSize, p.page * p.pageSize).map(shapeDevice), total, page: p.page, pageSize: p.pageSize, pages: Math.max(1, Math.ceil(total / p.pageSize)) };
}

/** Evaluate an unsaved filter against the fleet. */
export async function previewFilter(orgId: string, filter: DeviceFilterT, p: { page: number; pageSize: number; siteIds?: string[] }) {
  const devices = await activeDevices(orgId, p.siteIds);
  const rows = devices.filter((d) => evalFilter(d as unknown as Record<string, unknown>, filter as DeviceFilter)).sort((a, b) => a.name.localeCompare(b.name));
  const total = rows.length;
  return { items: rows.slice((p.page - 1) * p.pageSize, p.page * p.pageSize).map(shapeDevice), total, page: p.page, pageSize: p.pageSize, pages: Math.max(1, Math.ceil(total / p.pageSize)), fleet: devices.length };
}

function validateFilter(filter: DeviceFilterT | null | undefined, isDynamic: boolean) {
  if (!isDynamic) return null;
  const clauses = [...(filter?.all ?? []), ...(filter?.any ?? [])];
  if (!clauses.length) throw new ServiceError(400, "A dynamic group needs at least one filter clause", "bad_request");
  for (const c of clauses) {
    if (c.op === "regex") { try { new RegExp(String(c.value ?? "")); } catch { throw new ServiceError(400, `Invalid regular expression for ${c.field}`, "bad_request"); } }
    if (c.op !== "exists" && c.value === undefined) throw new ServiceError(400, `Clause "${c.field} ${c.op}" needs a value`, "bad_request");
    if (c.op === "in" && !Array.isArray(c.value)) throw new ServiceError(400, `Clause "${c.field} in" needs a list of values`, "bad_request");
  }
  return filter as DeviceFilter;
}

async function assertParent(orgId: string, parentId: string | null | undefined, selfId?: string) {
  if (!parentId) return;
  if (parentId === selfId) throw new ServiceError(400, "A group cannot be its own parent", "bad_request");
  const all = await listGroups(orgId);
  const parent = all.find((g) => g.id === parentId);
  if (!parent) throw new ServiceError(400, "Parent group not found in this organization", "bad_request");
  // Walk up from the parent: if we reach selfId the move would create a cycle.
  let cur: GroupNode | undefined = parent;
  let hops = 0;
  while (cur && hops++ < 50) {
    if (cur.id === selfId) throw new ServiceError(400, "Moving the group under one of its own descendants would create a cycle", "bad_request");
    cur = cur.parentId ? all.find((g) => g.id === cur!.parentId) : undefined;
  }
}

async function assertDevicesInOrg(orgId: string, deviceIds: string[], siteIds?: string[]) {
  const db = await getDb();
  const unique = [...new Set(deviceIds)];
  const rows = await db.select({ id: schema.devices.id }).from(schema.devices).where(and(eq(schema.devices.orgId, orgId), inArray(schema.devices.id, unique), siteIds?.length ? inArray(schema.devices.siteId, siteIds) : undefined));
  const missing = unique.filter((id) => !rows.some((r) => r.id === id));
  if (missing.length) throw new ServiceError(404, `${missing.length} device${missing.length === 1 ? "" : "s"} not found in this organization`, "not_found");
  return unique;
}

export async function createGroup(orgId: string, input: GroupCreateT, scope?: string[]) {
  const db = await getDb();
  if (input.siteId) {
    const [site] = await db.select({ id: schema.sites.id }).from(schema.sites).where(and(eq(schema.sites.orgId, orgId), eq(schema.sites.id, input.siteId)));
    if (!site) throw new ServiceError(400, "Site not found in this organization", "bad_request");
  }
  await assertParent(orgId, input.parentId);
  const filter = validateFilter(input.filter, input.isDynamic);
  const dup = await db.select({ id: schema.deviceGroups.id }).from(schema.deviceGroups).where(and(eq(schema.deviceGroups.orgId, orgId), sql`lower(${schema.deviceGroups.name}) = lower(${input.name.trim()})`, input.parentId ? eq(schema.deviceGroups.parentId, input.parentId) : sql`${schema.deviceGroups.parentId} is null`));
  if (dup.length) throw new ServiceError(409, `A group named "${input.name}" already exists at this level`, "conflict");
  const [{ max }] = await db.select({ max: sql<number>`coalesce(max(${schema.deviceGroups.sortOrder}), -1)::int` }).from(schema.deviceGroups).where(eq(schema.deviceGroups.orgId, orgId));
  const [row] = await db.insert(schema.deviceGroups).values({ orgId, name: input.name.trim(), description: input.description ?? null, color: input.color ?? null, icon: input.icon ?? null, siteId: input.siteId ?? null, parentId: input.parentId ?? null, isDynamic: input.isDynamic, filter, sortOrder: input.sortOrder ?? max + 1 }).returning();
  if (!input.isDynamic && input.deviceIds?.length) {
    const ids = await assertDevicesInOrg(orgId, input.deviceIds, scope);
    await db.insert(schema.deviceGroupMembers).values(ids.map((deviceId) => ({ groupId: row.id, deviceId }))).onConflictDoNothing();
  }
  bus.publish("group.created", { id: row.id, name: row.name, isDynamic: row.isDynamic }, { orgId });
  return (await getGroup(orgId, row.id))!;
}

export async function updateGroup(orgId: string, id: string, patch: GroupPatchT) {
  const db = await getDb();
  const [group] = await db.select().from(schema.deviceGroups).where(and(eq(schema.deviceGroups.orgId, orgId), eq(schema.deviceGroups.id, id)));
  if (!group) return null;
  if (patch.parentId !== undefined) await assertParent(orgId, patch.parentId, id);
  if (patch.siteId) {
    const [site] = await db.select({ id: schema.sites.id }).from(schema.sites).where(and(eq(schema.sites.orgId, orgId), eq(schema.sites.id, patch.siteId)));
    if (!site) throw new ServiceError(400, "Site not found in this organization", "bad_request");
  }
  const isDynamic = patch.isDynamic ?? group.isDynamic;
  const filter = patch.filter !== undefined || patch.isDynamic !== undefined ? validateFilter(patch.filter === undefined ? (group.filter as DeviceFilterT | null) : patch.filter, isDynamic) : group.filter;
  const set: Partial<typeof schema.deviceGroups.$inferInsert> = { updatedAt: new Date(), isDynamic, filter };
  if (patch.name !== undefined) set.name = patch.name.trim();
  if (patch.description !== undefined) set.description = patch.description;
  if (patch.color !== undefined) set.color = patch.color;
  if (patch.icon !== undefined) set.icon = patch.icon;
  if (patch.siteId !== undefined) set.siteId = patch.siteId;
  if (patch.parentId !== undefined) set.parentId = patch.parentId;
  if (patch.sortOrder !== undefined) set.sortOrder = patch.sortOrder;
  await db.update(schema.deviceGroups).set(set).where(eq(schema.deviceGroups.id, id));
  if (isDynamic && !group.isDynamic) await db.delete(schema.deviceGroupMembers).where(eq(schema.deviceGroupMembers.groupId, id));
  bus.publish("group.updated", { id, name: set.name ?? group.name, changed: Object.keys(patch) }, { orgId });
  return (await getGroup(orgId, id))!;
}

/** Swap sort order with the previous/next sibling. */
export async function moveGroup(orgId: string, id: string, direction: "up" | "down") {
  const db = await getDb();
  const all = await listGroups(orgId);
  const g = all.find((x) => x.id === id);
  if (!g) return null;
  const siblings = all.filter((x) => (x.parentId ?? null) === (g.parentId ?? null));
  const idx = siblings.findIndex((x) => x.id === id);
  const other = siblings[direction === "up" ? idx - 1 : idx + 1];
  if (!other) return { moved: false };
  const a = g.sortOrder === other.sortOrder ? (direction === "up" ? other.sortOrder - 1 : other.sortOrder + 1) : other.sortOrder;
  const b = g.sortOrder === other.sortOrder ? g.sortOrder : g.sortOrder;
  await db.update(schema.deviceGroups).set({ sortOrder: a }).where(eq(schema.deviceGroups.id, id));
  await db.update(schema.deviceGroups).set({ sortOrder: b }).where(eq(schema.deviceGroups.id, other.id));
  bus.publish("group.updated", { id, name: g.name, changed: ["sortOrder"] }, { orgId });
  return { moved: true };
}

export async function deleteGroup(orgId: string, id: string) {
  const db = await getDb();
  const group = await getGroup(orgId, id);
  if (!group) return null;
  // Re-parent children to the deleted group's parent and clear primary assignments.
  await db.update(schema.deviceGroups).set({ parentId: group.parentId ?? null }).where(and(eq(schema.deviceGroups.orgId, orgId), eq(schema.deviceGroups.parentId, id)));
  await db.update(schema.devices).set({ groupId: null }).where(eq(schema.devices.groupId, id));
  await db.delete(schema.deviceGroups).where(eq(schema.deviceGroups.id, id));
  bus.publish("group.deleted", { id, name: group.name, children: group.children.length }, { orgId });
  return group;
}

export async function addGroupMembers(orgId: string, id: string, deviceIds: string[], scope?: string[]) {
  const db = await getDb();
  const [group] = await db.select().from(schema.deviceGroups).where(and(eq(schema.deviceGroups.orgId, orgId), eq(schema.deviceGroups.id, id)));
  if (!group) return null;
  if (group.isDynamic) throw new ServiceError(409, "Dynamic groups compute their members from the filter; edit the filter instead", "dynamic_group");
  const ids = await assertDevicesInOrg(orgId, deviceIds, scope);
  const before = (await staticMemberIds([id])).get(id)!;
  const fresh = ids.filter((d) => !before.has(d));
  if (fresh.length) await db.insert(schema.deviceGroupMembers).values(fresh.map((deviceId) => ({ groupId: id, deviceId }))).onConflictDoNothing();
  bus.publish("group.members_changed", { id, name: group.name, added: fresh.length }, { orgId });
  for (const deviceId of fresh) bus.publish("device.group_added", { groupId: id, groupName: group.name }, { orgId, deviceId });
  return { added: fresh.length, total: before.size + fresh.length };
}

export async function removeGroupMembers(orgId: string, id: string, deviceIds: string[]) {
  const db = await getDb();
  const [group] = await db.select().from(schema.deviceGroups).where(and(eq(schema.deviceGroups.orgId, orgId), eq(schema.deviceGroups.id, id)));
  if (!group) return null;
  if (group.isDynamic) throw new ServiceError(409, "Dynamic groups compute their members from the filter; edit the filter instead", "dynamic_group");
  const unique = [...new Set(deviceIds)];
  const removed = await db.delete(schema.deviceGroupMembers).where(and(eq(schema.deviceGroupMembers.groupId, id), inArray(schema.deviceGroupMembers.deviceId, unique))).returning();
  const unassigned = await db.update(schema.devices).set({ groupId: null }).where(and(eq(schema.devices.groupId, id), inArray(schema.devices.id, unique), eq(schema.devices.orgId, orgId))).returning({ id: schema.devices.id });
  const n = new Set([...removed.map((r) => r.deviceId), ...unassigned.map((r) => r.id)]).size;
  bus.publish("group.members_changed", { id, name: group.name, removed: n }, { orgId });
  return { removed: n };
}
