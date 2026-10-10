/**
 * Maintenance windows: planned periods during which alerts are suppressed and/or patching and reboots are
 * allowed for a set of targets (org, sites, groups, devices). One-off windows use startsAt/endsAt; recurring
 * windows add an RFC 5545-style RRULE (FREQ=DAILY|WEEKLY|MONTHLY, INTERVAL, BYDAY, BYHOUR, BYMINUTE, UNTIL)
 * where startsAt..endsAt define the duration and the first occurrence. Loaded at boot by modules: no Next imports.
 */
import { and, desc, eq, ilike, inArray, sql, type SQL } from "drizzle-orm";
import { getDb, schema } from "../db";
import { bus } from "../bus";
import { fromZoned, isValidTimezone, zonedParts } from "./cron";
import { groupsForDevice } from "./device-filter";

export type MaintenanceWindow = typeof schema.maintenanceWindows.$inferSelect;
export type MaintenancePurpose = "alerts" | "patching" | "reboots";

/* ------------------------------------------------------------------ recurrence */

export interface Recurrence {
  freq: "DAILY" | "WEEKLY" | "MONTHLY";
  interval: number;
  byDay?: number[]; // 0 = Sunday
  byMonthDay?: number[];
  byHour?: number;
  byMinute?: number;
  until?: Date;
}

const RRULE_DAYS: Record<string, number> = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };

/** Parse an RRULE string (with or without the "RRULE:" prefix). Returns null when it cannot be understood. */
export function parseRecurrence(rule: string | null | undefined): Recurrence | null {
  if (!rule) return null;
  const body = rule.trim().replace(/^RRULE:/i, "");
  const parts = Object.fromEntries(body.split(";").filter(Boolean).map((kv) => { const [k, v] = kv.split("="); return [k.trim().toUpperCase(), (v ?? "").trim()]; }));
  const freq = String(parts.FREQ ?? "").toUpperCase();
  if (freq !== "DAILY" && freq !== "WEEKLY" && freq !== "MONTHLY") return null;
  const r: Recurrence = { freq, interval: Math.max(1, Number.parseInt(parts.INTERVAL ?? "1", 10) || 1) };
  if (parts.BYDAY) {
    r.byDay = parts.BYDAY.split(",").map((d) => RRULE_DAYS[d.trim().toUpperCase().slice(-2)]).filter((d) => d !== undefined);
    if (!r.byDay.length) delete r.byDay;
  }
  if (parts.BYMONTHDAY) r.byMonthDay = parts.BYMONTHDAY.split(",").map((d) => Number.parseInt(d, 10)).filter((d) => d >= 1 && d <= 31);
  if (parts.BYHOUR !== undefined && parts.BYHOUR !== "") r.byHour = Number.parseInt(parts.BYHOUR, 10);
  if (parts.BYMINUTE !== undefined && parts.BYMINUTE !== "") r.byMinute = Number.parseInt(parts.BYMINUTE, 10);
  if (parts.UNTIL) {
    const m = parts.UNTIL.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?Z?)?$/);
    if (m) r.until = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +(m[4] ?? 23), +(m[5] ?? 59), +(m[6] ?? 59)));
    else { const d = new Date(parts.UNTIL); if (!Number.isNaN(d.getTime())) r.until = d; }
  }
  return r;
}

/** Build an RRULE string from the editor's structured form. */
export function buildRecurrence(r: Recurrence): string {
  const parts = [`FREQ=${r.freq}`];
  if (r.interval > 1) parts.push(`INTERVAL=${r.interval}`);
  if (r.byDay?.length) parts.push(`BYDAY=${r.byDay.map((d) => Object.keys(RRULE_DAYS).find((k) => RRULE_DAYS[k] === d)).filter(Boolean).join(",")}`);
  if (r.byMonthDay?.length) parts.push(`BYMONTHDAY=${r.byMonthDay.join(",")}`);
  if (r.byHour !== undefined) parts.push(`BYHOUR=${r.byHour}`);
  if (r.byMinute !== undefined) parts.push(`BYMINUTE=${r.byMinute}`);
  if (r.until) parts.push(`UNTIL=${r.until.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z")}`);
  return parts.join(";");
}

function dayKey(y: number, m: number, d: number) { return Date.UTC(y, m - 1, d); }

/** Occurrence starts (as instants) that begin within [from, to] for a recurring window. */
export function occurrencesBetween(w: Pick<MaintenanceWindow, "startsAt" | "endsAt" | "recurrence" | "timezone">, from: Date, to: Date, limit = 50): Date[] {
  const rec = parseRecurrence(w.recurrence);
  if (!rec) return w.startsAt >= from && w.startsAt <= to ? [w.startsAt] : [];
  const tz = isValidTimezone(w.timezone) ? w.timezone : "UTC";
  const anchor = zonedParts(w.startsAt, tz);
  const hour = rec.byHour ?? anchor.hour;
  const minute = rec.byMinute ?? anchor.minute;
  const out: Date[] = [];
  const startDay = zonedParts(new Date(Math.max(from.getTime(), w.startsAt.getTime()) - 86400_000), tz);
  const endDay = zonedParts(to, tz);
  const cursor = new Date(dayKey(startDay.year, startDay.month, startDay.day));
  const last = dayKey(endDay.year, endDay.month, endDay.day);
  const anchorDay = dayKey(anchor.year, anchor.month, anchor.day);
  let guard = 0;
  while (cursor.getTime() <= last && guard++ < 1000 && out.length < limit) {
    const y = cursor.getUTCFullYear(), m = cursor.getUTCMonth() + 1, d = cursor.getUTCDate(), wd = cursor.getUTCDay();
    const daysSinceAnchor = Math.round((cursor.getTime() - anchorDay) / 86400_000);
    let matches = daysSinceAnchor >= 0;
    if (matches) {
      if (rec.freq === "DAILY") matches = daysSinceAnchor % rec.interval === 0 && (!rec.byDay || rec.byDay.includes(wd));
      else if (rec.freq === "WEEKLY") {
        const anchorWeekStart = anchorDay - new Date(anchorDay).getUTCDay() * 86400_000;
        const weeks = Math.floor((cursor.getTime() - anchorWeekStart) / (7 * 86400_000));
        matches = weeks % rec.interval === 0 && (rec.byDay ? rec.byDay.includes(wd) : wd === anchor.weekday);
      } else {
        const months = (y - anchor.year) * 12 + (m - anchor.month);
        matches = months % rec.interval === 0 && (rec.byMonthDay ? rec.byMonthDay.includes(d) : d === anchor.day) && (!rec.byDay || rec.byDay.includes(wd));
      }
    }
    if (matches) {
      const start = fromZoned({ year: y, month: m, day: d, hour, minute }, tz);
      if (start && start >= from && start <= to && start >= w.startsAt && (!rec.until || start <= rec.until)) out.push(start);
    }
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return out;
}

/** Duration of one occurrence in ms (endsAt - startsAt, minimum one minute). */
export function windowDurationMs(w: Pick<MaintenanceWindow, "startsAt" | "endsAt">): number {
  return Math.max(60_000, w.endsAt.getTime() - w.startsAt.getTime());
}

/** Is the window active at `now`? Returns the active occurrence bounds when it is. */
export function windowActiveAt(w: Pick<MaintenanceWindow, "startsAt" | "endsAt" | "recurrence" | "timezone">, now = new Date()): { start: Date; end: Date } | null {
  if (!w.recurrence) return w.startsAt <= now && now < w.endsAt ? { start: w.startsAt, end: w.endsAt } : null;
  const dur = windowDurationMs(w);
  const starts = occurrencesBetween(w, new Date(now.getTime() - dur), now);
  for (const s of starts.reverse()) if (s.getTime() <= now.getTime() && now.getTime() < s.getTime() + dur) return { start: s, end: new Date(s.getTime() + dur) };
  return null;
}

/** Next occurrence start at or after `now` (null for finished one-off windows). */
export function nextOccurrence(w: Pick<MaintenanceWindow, "startsAt" | "endsAt" | "recurrence" | "timezone">, now = new Date()): Date | null {
  if (!w.recurrence) return w.startsAt >= now ? w.startsAt : null;
  const horizon = new Date(now.getTime() + 400 * 86400_000);
  const list = occurrencesBetween(w, now, horizon, 1);
  return list[0] ?? null;
}

/* ------------------------------------------------------------------ CRUD */

export interface MaintenanceListParams { orgId: string; q?: string; targetType?: string; status?: "active" | "upcoming" | "past" | "all"; page: number; pageSize: number }

export async function listMaintenanceWindows(p: MaintenanceListParams) {
  const db = await getDb();
  const where: SQL[] = [eq(schema.maintenanceWindows.orgId, p.orgId)];
  if (p.q) where.push(ilike(schema.maintenanceWindows.name, `%${p.q.replace(/[%_]/g, "\\$&")}%`));
  if (p.targetType) where.push(eq(schema.maintenanceWindows.targetType, p.targetType as MaintenanceWindow["targetType"]));
  const rows = await db.select().from(schema.maintenanceWindows).where(and(...where)).orderBy(desc(schema.maintenanceWindows.startsAt));
  const now = new Date();
  const decorated = rows.map((w) => decorate(w, now));
  const filtered = p.status && p.status !== "all" ? decorated.filter((w) => w.state === p.status) : decorated;
  const total = filtered.length;
  const items = filtered.slice((p.page - 1) * p.pageSize, p.page * p.pageSize);
  return { items, total, page: p.page, pageSize: p.pageSize, pages: Math.max(1, Math.ceil(total / p.pageSize)) };
}

export function decorate(w: MaintenanceWindow, now = new Date()) {
  const active = windowActiveAt(w, now);
  const next = active ? null : nextOccurrence(w, now);
  const state: "active" | "upcoming" | "past" = active ? "active" : next ? "upcoming" : "past";
  return { ...w, state, activeUntil: active?.end ?? null, nextStartsAt: next, durationMs: windowDurationMs(w), recurrenceParsed: parseRecurrence(w.recurrence) };
}

export async function getMaintenanceWindow(id: string, orgId: string) {
  const db = await getDb();
  const [row] = await db.select().from(schema.maintenanceWindows).where(and(eq(schema.maintenanceWindows.id, id), eq(schema.maintenanceWindows.orgId, orgId)));
  return row ? decorate(row) : null;
}

export interface MaintenanceInput {
  name: string; description?: string | null; targetType: MaintenanceWindow["targetType"]; targetIds?: string[]; startsAt: Date; endsAt: Date; recurrence?: string | null; timezone?: string;
  suppressAlerts?: boolean; allowPatching?: boolean; allowReboots?: boolean;
}

export async function createMaintenanceWindow(orgId: string, input: MaintenanceInput, createdBy: string | null) {
  const db = await getDb();
  if (input.endsAt <= input.startsAt) throw new Error("endsAt must be after startsAt");
  if (input.recurrence && !parseRecurrence(input.recurrence)) throw new Error("Unsupported recurrence rule (use FREQ=DAILY|WEEKLY|MONTHLY with optional INTERVAL, BYDAY, BYMONTHDAY, BYHOUR, BYMINUTE, UNTIL)");
  const [row] = await db.insert(schema.maintenanceWindows).values({ orgId, name: input.name, description: input.description ?? null, targetType: input.targetType, targetIds: input.targetIds ?? [], startsAt: input.startsAt, endsAt: input.endsAt, recurrence: input.recurrence || null, timezone: input.timezone && isValidTimezone(input.timezone) ? input.timezone : "UTC", suppressAlerts: input.suppressAlerts ?? true, allowPatching: input.allowPatching ?? true, allowReboots: input.allowReboots ?? true, createdBy }).returning();
  bus.publish("maintenance.created", { id: row.id, name: row.name }, { orgId });
  return decorate(row);
}

export async function updateMaintenanceWindow(id: string, orgId: string, patch: Partial<MaintenanceInput>) {
  const db = await getDb();
  const existing = await getMaintenanceWindow(id, orgId);
  if (!existing) return null;
  const startsAt = patch.startsAt ?? existing.startsAt;
  const endsAt = patch.endsAt ?? existing.endsAt;
  if (endsAt <= startsAt) throw new Error("endsAt must be after startsAt");
  if (patch.recurrence && !parseRecurrence(patch.recurrence)) throw new Error("Unsupported recurrence rule");
  const [row] = await db.update(schema.maintenanceWindows).set({
    ...(patch.name !== undefined ? { name: patch.name } : {}),
    ...(patch.description !== undefined ? { description: patch.description } : {}),
    ...(patch.targetType !== undefined ? { targetType: patch.targetType } : {}),
    ...(patch.targetIds !== undefined ? { targetIds: patch.targetIds } : {}),
    startsAt, endsAt,
    ...(patch.recurrence !== undefined ? { recurrence: patch.recurrence || null } : {}),
    ...(patch.timezone !== undefined ? { timezone: isValidTimezone(patch.timezone) ? patch.timezone : "UTC" } : {}),
    ...(patch.suppressAlerts !== undefined ? { suppressAlerts: patch.suppressAlerts } : {}),
    ...(patch.allowPatching !== undefined ? { allowPatching: patch.allowPatching } : {}),
    ...(patch.allowReboots !== undefined ? { allowReboots: patch.allowReboots } : {}),
  }).where(and(eq(schema.maintenanceWindows.id, id), eq(schema.maintenanceWindows.orgId, orgId))).returning();
  bus.publish("maintenance.updated", { id, name: row.name }, { orgId });
  return decorate(row);
}

export async function deleteMaintenanceWindow(id: string, orgId: string) {
  const db = await getDb();
  const rows = await db.delete(schema.maintenanceWindows).where(and(eq(schema.maintenanceWindows.id, id), eq(schema.maintenanceWindows.orgId, orgId))).returning({ id: schema.maintenanceWindows.id, name: schema.maintenanceWindows.name });
  if (rows.length) bus.publish("maintenance.deleted", { id, name: rows[0].name }, { orgId });
  return rows.length > 0;
}

/* ------------------------------------------------------------------ "active now" evaluation */

const cache = new Map<string, { at: number; rows: MaintenanceWindow[] }>();
async function windowsForOrg(orgId: string): Promise<MaintenanceWindow[]> {
  const c = cache.get(orgId);
  if (c && Date.now() - c.at < 15_000) return c.rows;
  const db = await getDb();
  const rows = await db.select().from(schema.maintenanceWindows).where(eq(schema.maintenanceWindows.orgId, orgId));
  cache.set(orgId, { at: Date.now(), rows });
  return rows;
}
bus.subscribe("maintenance.*", (ev) => { if (ev.orgId) cache.delete(ev.orgId); });

function windowTargets(w: MaintenanceWindow, device: { id: string; siteId: string | null }, groupIds: string[]): boolean {
  switch (w.targetType) {
    case "org": return true;
    case "site": return !!device.siteId && w.targetIds.includes(device.siteId);
    case "group": return groupIds.some((g) => w.targetIds.includes(g));
    case "device": return w.targetIds.includes(device.id);
    default: return false;
  }
}

/** Windows active right now that cover a device (optionally only those relevant to a purpose). */
export async function activeWindowsForDevice(deviceId: string, purpose?: MaintenancePurpose, now = new Date()) {
  const db = await getDb();
  const [device] = await db.select().from(schema.devices).where(eq(schema.devices.id, deviceId));
  if (!device) return [];
  const windows = (await windowsForOrg(device.orgId)).filter((w) => windowActiveAt(w, now));
  if (!windows.length) return [];
  const groupIds = windows.some((w) => w.targetType === "group") ? await groupsForDevice(device) : [];
  return windows.filter((w) => windowTargets(w, device, groupIds)).filter((w) => {
    if (purpose === "alerts") return w.suppressAlerts;
    if (purpose === "patching") return w.allowPatching;
    if (purpose === "reboots") return w.allowReboots;
    return true;
  });
}

/** True when the device is inside a maintenance window (for alerts: one that suppresses alerts). */
export async function isInMaintenance(deviceId: string, purpose: MaintenancePurpose = "alerts", now = new Date()): Promise<boolean> {
  return (await activeWindowsForDevice(deviceId, purpose, now)).length > 0;
}

/** Active windows across an org right now, with the device count they cover. */
export async function activeWindows(orgId: string, now = new Date()) {
  const windows = (await windowsForOrg(orgId)).filter((w) => windowActiveAt(w, now)).map((w) => decorate(w, now));
  const db = await getDb();
  const out = [] as (ReturnType<typeof decorate> & { deviceCount: number })[];
  for (const w of windows) {
    let deviceCount = 0;
    if (w.targetType === "org") deviceCount = (await db.select({ n: sql<number>`count(*)::int` }).from(schema.devices).where(and(eq(schema.devices.orgId, orgId), sql`${schema.devices.status} <> 'decommissioned'`)))[0].n;
    else if (w.targetType === "site" && w.targetIds.length) deviceCount = (await db.select({ n: sql<number>`count(*)::int` }).from(schema.devices).where(and(eq(schema.devices.orgId, orgId), inArray(schema.devices.siteId, w.targetIds))))[0].n;
    else if (w.targetType === "device") deviceCount = w.targetIds.length;
    else if (w.targetType === "group" && w.targetIds.length) deviceCount = (await db.select({ n: sql<number>`count(*)::int` }).from(schema.devices).where(and(eq(schema.devices.orgId, orgId), inArray(schema.devices.groupId, w.targetIds))))[0].n;
    out.push({ ...w, deviceCount });
  }
  return out;
}
