/**
 * Patch state: scan results from agents are upserted per (device, externalId); fleet views group them by
 * externalId so one missing KB across 40 machines reads as one row. Loaded at boot by the patching module,
 * so no Next.js-only imports here.
 */
import { and, desc, eq, inArray, notInArray, sql, type SQL } from "drizzle-orm";
import { getDb, schema } from "../db";
import { bus } from "../bus";

export interface ScannedPatch {
  externalId: string; title: string; description?: string; source: string; category?: string; severity?: string; kb?: string; version?: string; currentVersion?: string; sizeBytes?: number; rebootRequired?: boolean; releaseDate?: string; supportUrl?: string;
}

type Source = typeof schema.patches.$inferSelect.source;
type Category = typeof schema.patches.$inferSelect.category;
type Severity = typeof schema.patches.$inferSelect.severity;

const SEVERITIES = ["critical", "important", "moderate", "low", "unknown"] as const;
const CATEGORIES = ["security", "critical", "important", "moderate", "low", "feature", "driver", "definition", "firmware", "application", "other"] as const;

/** Apply a scan: new/still-missing patches become "available"; ones that vanished are considered installed. */
export async function applyPatchScan(deviceId: string, orgId: string, manager: string, scanned: ScannedPatch[], rebootPending?: boolean) {
  const db = await getDb();
  const now = new Date();
  const ids = scanned.map((p) => p.externalId);
  const existing = await db.select({ id: schema.patches.id, externalId: schema.patches.externalId, status: schema.patches.status }).from(schema.patches).where(and(eq(schema.patches.deviceId, deviceId), inArray(schema.patches.status, ["available", "approved", "scheduled", "installing", "failed", "pending_reboot", "deferred"])));
  const existingIds = new Set(existing.map((e) => e.externalId));
  let added = 0;
  for (const p of scanned) {
    const row = {
      orgId, deviceId, externalId: p.externalId, title: p.title.slice(0, 500), description: p.description?.slice(0, 2000) ?? null,
      source: (p.source as Source) || "other",
      category: (CATEGORIES.includes(p.category as (typeof CATEGORIES)[number]) ? p.category : "other") as Category,
      severity: (SEVERITIES.includes(p.severity as (typeof SEVERITIES)[number]) ? p.severity : "unknown") as Severity,
      kb: p.kb || null, version: p.version || null, currentVersion: p.currentVersion || null, sizeBytes: p.sizeBytes ?? null, rebootRequired: !!p.rebootRequired, releaseDate: p.releaseDate ? new Date(p.releaseDate) : null, supportUrl: p.supportUrl || null, lastSeenAt: now,
    };
    if (existingIds.has(p.externalId)) {
      await db.update(schema.patches).set({ ...row, status: sql`case when ${schema.patches.status} in ('installing','pending_reboot','deferred','approved') then ${schema.patches.status} else 'available' end` }).where(and(eq(schema.patches.deviceId, deviceId), eq(schema.patches.externalId, p.externalId)));
    } else {
      await db.insert(schema.patches).values({ ...row, status: "available", firstSeenAt: now }).onConflictDoUpdate({ target: [schema.patches.deviceId, schema.patches.externalId], set: { ...row, status: "available", installedAt: null } });
      added++;
    }
  }
  // Anything previously outstanding that the scanner no longer reports is installed (or superseded).
  const gone = existing.filter((e) => !ids.includes(e.externalId));
  if (gone.length) await db.update(schema.patches).set({ status: "installed", installedAt: now }).where(and(eq(schema.patches.deviceId, deviceId), inArray(schema.patches.externalId, gone.map((e) => e.externalId))));
  await db.update(schema.devices).set({ lastPatchScanAt: now, ...(rebootPending !== undefined ? { pendingReboot: rebootPending } : {}) }).where(eq(schema.devices.id, deviceId));
  const summary = { deviceId, manager, available: scanned.length, added, installed: gone.length, security: scanned.filter((p) => p.category === "security").length };
  bus.publish("patches.scanned", summary, { orgId, deviceId });
  if (summary.security > 0 && added > 0) bus.publish("patches.security_pending", summary, { orgId, deviceId });
  return summary;
}

/** Record the outcome of an install job for the patches it targeted. */
export async function applyPatchInstallResult(deviceId: string, orgId: string, jobId: string, result: { installed?: string[]; failed?: { id: string; code?: unknown; hresult?: string; title?: string }[]; rebootRequired?: boolean }, targeted: { externalIds?: string[]; all?: boolean }) {
  const db = await getDb();
  const now = new Date();
  const installed = result.installed ?? [];
  const failed = result.failed ?? [];
  if (installed.length) await db.update(schema.patches).set({ status: result.rebootRequired ? "pending_reboot" : "installed", installedAt: now, lastJobId: jobId, installAttempts: sql`${schema.patches.installAttempts} + 1`, lastError: null }).where(and(eq(schema.patches.deviceId, deviceId), inArray(schema.patches.externalId, installed)));
  for (const f of failed) {
    await db.update(schema.patches).set({ status: "failed", lastJobId: jobId, installAttempts: sql`${schema.patches.installAttempts} + 1`, lastError: `${f.hresult ?? ""} code ${String(f.code ?? "?")}`.trim() }).where(and(eq(schema.patches.deviceId, deviceId), eq(schema.patches.externalId, f.id)));
  }
  if (targeted.all && !installed.length && !failed.length) {
    // Package managers that don't report per-package results: assume everything outstanding went in.
    await db.update(schema.patches).set({ status: result.rebootRequired ? "pending_reboot" : "installed", installedAt: now, lastJobId: jobId }).where(and(eq(schema.patches.deviceId, deviceId), inArray(schema.patches.status, ["available", "approved", "installing", "scheduled"])));
  }
  if (result.rebootRequired) await db.update(schema.devices).set({ pendingReboot: true }).where(eq(schema.devices.id, deviceId));
  bus.publish("patches.installed", { deviceId, jobId, installed: installed.length, failed: failed.length, rebootRequired: !!result.rebootRequired }, { orgId, deviceId });
}

export async function devicePatches(deviceId: string) {
  const db = await getDb();
  return db.select().from(schema.patches).where(eq(schema.patches.deviceId, deviceId)).orderBy(sql`case ${schema.patches.status} when 'available' then 0 when 'failed' then 1 when 'pending_reboot' then 2 when 'approved' then 3 else 9 end`, sql`case ${schema.patches.severity} when 'critical' then 0 when 'important' then 1 when 'moderate' then 2 when 'low' then 3 else 4 end`, desc(schema.patches.lastSeenAt)).limit(1000);
}

/** Fleet view: outstanding patches grouped by externalId with device counts. */
export async function fleetPatches(orgId: string, opts: { status?: string[]; severity?: string[]; category?: string[]; q?: string; siteIds?: string[]; page: number; pageSize: number }) {
  const db = await getDb();
  const where: SQL[] = [eq(schema.patches.orgId, orgId)];
  where.push(inArray(schema.patches.status, (opts.status?.length ? opts.status : ["available", "failed", "pending_reboot", "approved"]) as (typeof schema.patches.$inferSelect.status)[]));
  if (opts.severity?.length) where.push(inArray(schema.patches.severity, opts.severity as Severity[]));
  if (opts.category?.length) where.push(inArray(schema.patches.category, opts.category as Category[]));
  if (opts.q) where.push(sql`(${schema.patches.title} ilike ${"%" + opts.q + "%"} or ${schema.patches.kb} ilike ${"%" + opts.q + "%"} or ${schema.patches.externalId} ilike ${"%" + opts.q + "%"})`);
  if (opts.siteIds?.length) where.push(inArray(schema.devices.siteId, opts.siteIds));
  const base = db.select({ externalId: schema.patches.externalId, title: sql<string>`min(${schema.patches.title})`, source: sql<string>`min(${schema.patches.source})`, category: sql<string>`min(${schema.patches.category})`, severity: sql<string>`min(${schema.patches.severity})`, kb: sql<string | null>`min(${schema.patches.kb})`, version: sql<string | null>`min(${schema.patches.version})`, devices: sql<number>`count(distinct ${schema.patches.deviceId})::int`, failed: sql<number>`count(*) filter (where ${schema.patches.status} = 'failed')::int`, rebootRequired: sql<boolean>`bool_or(${schema.patches.rebootRequired})`, firstSeenAt: sql<string>`min(${schema.patches.firstSeenAt})` }).from(schema.patches).leftJoin(schema.devices, eq(schema.devices.id, schema.patches.deviceId)).where(and(...where)).groupBy(schema.patches.externalId);
  const rows = await base.orderBy(sql`case min(${schema.patches.severity}) when 'critical' then 0 when 'important' then 1 when 'moderate' then 2 when 'low' then 3 else 4 end`, sql`count(distinct ${schema.patches.deviceId}) desc`).limit(opts.pageSize).offset((opts.page - 1) * opts.pageSize);
  const [{ total }] = await db.select({ total: sql<number>`count(distinct ${schema.patches.externalId})::int` }).from(schema.patches).leftJoin(schema.devices, eq(schema.devices.id, schema.patches.deviceId)).where(and(...where));
  return { items: rows, total, page: opts.page, pageSize: opts.pageSize, pages: Math.max(1, Math.ceil(total / opts.pageSize)) };
}

export async function patchSummary(orgId: string, siteIds?: string[]) {
  const db = await getDb();
  const scope = and(eq(schema.devices.orgId, orgId), sql`${schema.devices.status} <> 'decommissioned'`, siteIds?.length ? inArray(schema.devices.siteId, siteIds) : undefined);
  const [row] = await db
    .select({
      devices: sql<number>`count(*)::int`,
      scanned: sql<number>`count(*) filter (where ${schema.devices.lastPatchScanAt} is not null)::int`,
      pendingReboot: sql<number>`count(*) filter (where ${schema.devices.pendingReboot})::int`,
      missingAny: sql<number>`count(*) filter (where exists (select 1 from ${schema.patches} p where p.device_id = ${schema.devices}."id" and p.status in ('available','failed')))::int`,
      missingSecurity: sql<number>`count(*) filter (where exists (select 1 from ${schema.patches} p where p.device_id = ${schema.devices}."id" and p.status in ('available','failed') and p.category = 'security'))::int`,
      failed: sql<number>`count(*) filter (where exists (select 1 from ${schema.patches} p where p.device_id = ${schema.devices}."id" and p.status = 'failed'))::int`,
    })
    .from(schema.devices)
    .where(scope);
  const [agg] = await db.select({ outstanding: sql<number>`count(*)::int`, security: sql<number>`count(*) filter (where ${schema.patches.category} = 'security')::int` }).from(schema.patches).innerJoin(schema.devices, eq(schema.devices.id, schema.patches.deviceId)).where(and(scope, inArray(schema.patches.status, ["available", "failed"])));
  return { ...row, compliant: row.scanned - row.missingAny, outstanding: agg?.outstanding ?? 0, outstandingSecurity: agg?.security ?? 0 };
}

/** Devices that have a given patch outstanding (fleet drill-down / "install on all"). */
export async function devicesMissingPatch(orgId: string, externalId: string) {
  const db = await getDb();
  return db.select({ deviceId: schema.patches.deviceId, status: schema.patches.status, lastError: schema.patches.lastError, deviceName: schema.devices.name, platform: schema.devices.platform, deviceStatus: schema.devices.status }).from(schema.patches).innerJoin(schema.devices, eq(schema.devices.id, schema.patches.deviceId)).where(and(eq(schema.patches.orgId, orgId), eq(schema.patches.externalId, externalId), notInArray(schema.patches.status, ["installed", "superseded", "not_applicable", "rejected"]))).orderBy(schema.devices.name);
}
