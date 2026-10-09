/**
 * Device targeting: resolves job/policy/monitor targets (device, group, site, org, filter) to device ids,
 * and evaluates the DeviceFilter JSON query language used by dynamic groups and automations.
 */
import { and, eq, inArray } from "drizzle-orm";
import { getDb, schema } from "../db";
import type { DeviceFilter, DeviceFilterClause } from "../db/schema/devices";

type Row = Record<string, unknown>;

function getPath(obj: Row, path: string): unknown {
  return path.split(".").reduce<unknown>((acc, k) => (acc && typeof acc === "object" ? (acc as Row)[k] : undefined), obj);
}

export function evalClause(device: Row, c: DeviceFilterClause): boolean {
  const v = getPath(device, c.field);
  const val = c.value;
  switch (c.op) {
    case "exists": return v !== undefined && v !== null && v !== "";
    case "eq": return Array.isArray(v) ? v.includes(val) : v === val || String(v).toLowerCase() === String(val).toLowerCase();
    case "neq": return !(Array.isArray(v) ? v.includes(val) : v === val || String(v).toLowerCase() === String(val).toLowerCase());
    case "contains": return Array.isArray(v) ? v.some((x) => String(x).toLowerCase().includes(String(val).toLowerCase())) : String(v ?? "").toLowerCase().includes(String(val).toLowerCase());
    case "startsWith": return String(v ?? "").toLowerCase().startsWith(String(val).toLowerCase());
    case "gt": return Number(v) > Number(val);
    case "lt": return Number(v) < Number(val);
    case "gte": return Number(v) >= Number(val);
    case "lte": return Number(v) <= Number(val);
    case "in": return Array.isArray(val) ? (Array.isArray(v) ? v.some((x) => (val as unknown[]).includes(x)) : (val as unknown[]).includes(v)) : false;
    case "regex": try { return new RegExp(String(val), "i").test(String(v ?? "")); } catch { return false; }
    default: return false;
  }
}

export function evalFilter(device: Row, f: DeviceFilter | null | undefined): boolean {
  if (!f) return true;
  if (f.all && !f.all.every((c) => evalClause(device, c))) return false;
  if (f.any && f.any.length && !f.any.some((c) => evalClause(device, c))) return false;
  return true;
}

/** Resolve the ids of devices a target expression refers to (within one org). Excludes decommissioned devices. */
export async function resolveTargets(orgId: string, targetType: "device" | "group" | "site" | "org" | "filter", targetIds: string[], filter: Record<string, unknown> | null): Promise<string[]> {
  const db = await getDb();
  const base = and(eq(schema.devices.orgId, orgId), inArray(schema.devices.status, ["online", "offline", "maintenance"]));
  switch (targetType) {
    case "device": {
      if (!targetIds.length) return [];
      const rows = await db.select({ id: schema.devices.id }).from(schema.devices).where(and(base, inArray(schema.devices.id, targetIds)));
      return rows.map((r) => r.id);
    }
    case "site": {
      if (!targetIds.length) return [];
      const rows = await db.select({ id: schema.devices.id }).from(schema.devices).where(and(base, inArray(schema.devices.siteId, targetIds)));
      return rows.map((r) => r.id);
    }
    case "org": {
      const rows = await db.select({ id: schema.devices.id }).from(schema.devices).where(base);
      return rows.map((r) => r.id);
    }
    case "group": {
      if (!targetIds.length) return [];
      const groups = await db.select().from(schema.deviceGroups).where(inArray(schema.deviceGroups.id, targetIds));
      const ids = new Set<string>();
      const staticIds = groups.filter((g) => !g.isDynamic).map((g) => g.id);
      if (staticIds.length) {
        for (const r of await db.select({ id: schema.devices.id }).from(schema.devices).where(and(base, inArray(schema.devices.groupId, staticIds)))) ids.add(r.id);
        for (const r of await db.select({ deviceId: schema.deviceGroupMembers.deviceId }).from(schema.deviceGroupMembers).where(inArray(schema.deviceGroupMembers.groupId, staticIds))) ids.add(r.deviceId);
      }
      const dynamic = groups.filter((g) => g.isDynamic);
      if (dynamic.length) {
        const all = await db.select().from(schema.devices).where(base);
        for (const d of all) if (dynamic.some((g) => evalFilter(d as unknown as Row, g.filter))) ids.add(d.id);
      }
      return [...ids];
    }
    case "filter": {
      const all = await db.select().from(schema.devices).where(base);
      return all.filter((d) => evalFilter(d as unknown as Row, filter as DeviceFilter | null)).map((d) => d.id);
    }
  }
}

/** Ids of the groups (static and dynamic) a device belongs to - used for policy resolution. */
export async function groupsForDevice(device: typeof schema.devices.$inferSelect): Promise<string[]> {
  const db = await getDb();
  const groups = await db.select().from(schema.deviceGroups).where(eq(schema.deviceGroups.orgId, device.orgId));
  const members = await db.select({ groupId: schema.deviceGroupMembers.groupId }).from(schema.deviceGroupMembers).where(eq(schema.deviceGroupMembers.deviceId, device.id));
  const ids = new Set<string>(members.map((m) => m.groupId));
  if (device.groupId) ids.add(device.groupId);
  for (const g of groups) if (g.isDynamic && evalFilter(device as unknown as Row, g.filter)) ids.add(g.id);
  return [...ids];
}
