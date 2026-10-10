/**
 * Software licenses: seats vs installs (counted from the inventory through `matchName`), expiry state and the
 * encrypted key (`keyEnc`, revealed only through the audited reveal endpoint).
 */
import { and, asc, eq, ilike, inArray, isNull, or, sql, type SQL } from "drizzle-orm";
import { getDb, schema } from "../db";
import { bus } from "../bus";
import { decryptSecret, encryptSecret } from "../util/crypto";
import { likePattern } from "./software-inventory";
import type { LicenseBody, LicensePatch } from "../api/contracts/software";

const lic = schema.softwareLicenses;
const sw = schema.deviceSoftware;
const d = schema.devices;

export type LicenseState = "ok" | "over" | "expiring" | "expired" | "unmatched";
export const EXPIRING_DAYS = 30;

export interface LicenseView {
  id: string; orgId: string; name: string; vendor: string | null; matchName: string | null; seats: number | null; hasKey: boolean; purchaseDate: Date | null; expiresAt: Date | null; cost: number | null; currency: string | null; notes: string | null; createdAt: Date; updatedAt: Date;
  installed: number; utilization: number | null; available: number | null; expiresInDays: number | null; state: LicenseState;
}

/** Pure: compute the derived fields of a license. */
export function licenseState(l: { seats: number | null; expiresAt: Date | null; matchName: string | null }, installed: number, now = Date.now()): Pick<LicenseView, "utilization" | "available" | "expiresInDays" | "state"> {
  const expiresInDays = l.expiresAt ? Math.ceil((l.expiresAt.getTime() - now) / 86400_000) : null;
  const utilization = l.seats ? Math.round((installed / l.seats) * 100) : null;
  const available = l.seats !== null && l.seats !== undefined ? l.seats - installed : null;
  let state: LicenseState = "ok";
  if (expiresInDays !== null && expiresInDays < 0) state = "expired";
  else if (l.seats !== null && l.seats !== undefined && installed > l.seats) state = "over";
  else if (expiresInDays !== null && expiresInDays <= EXPIRING_DAYS) state = "expiring";
  else if (!l.matchName) state = "unmatched";
  return { utilization, available, expiresInDays, state };
}

async function installCounts(orgId: string, rows: { id: string; matchName: string | null }[], siteIds?: string[]): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  const db = await getDb();
  for (const r of rows) {
    if (!r.matchName) { out[r.id] = 0; continue; }
    const where: SQL[] = [eq(sw.orgId, orgId), isNull(sw.removedAt), ilike(sw.name, likePattern(r.matchName)), sql`${d.status} <> 'decommissioned'`];
    if (siteIds?.length) where.push(inArray(d.siteId, siteIds));
    const [{ n }] = await db.select({ n: sql<number>`count(distinct ${sw.deviceId})::int` }).from(sw).innerJoin(d, eq(d.id, sw.deviceId)).where(and(...where));
    out[r.id] = n;
  }
  return out;
}

function toView(row: typeof lic.$inferSelect, installed: number): LicenseView {
  const { keyEnc, attachments: _a, ...rest } = row;
  void _a;
  return { ...rest, hasKey: !!keyEnc, installed, ...licenseState(row, installed) };
}

export interface LicenseListParams { orgId: string; q?: string; state?: LicenseState; vendor?: string; sort?: string; dir?: "asc" | "desc"; page: number; pageSize: number; siteIds?: string[] }

export async function listLicenses(p: LicenseListParams) {
  const db = await getDb();
  const where: SQL[] = [eq(lic.orgId, p.orgId)];
  if (p.vendor) where.push(ilike(lic.vendor, likePattern(p.vendor)));
  if (p.q) { const like = likePattern(p.q); where.push(or(ilike(lic.name, like), ilike(lic.vendor, like), ilike(lic.matchName, like), ilike(lic.notes, like))!); }
  const rows = await db.select().from(lic).where(and(...where)).orderBy(asc(lic.name));
  const counts = await installCounts(p.orgId, rows, p.siteIds);
  let items = rows.map((r) => toView(r, counts[r.id] ?? 0));
  if (p.state) items = items.filter((i) => i.state === p.state);
  const dir = p.dir === "desc" ? -1 : 1;
  const key = (p.sort ?? "name") as keyof LicenseView;
  items.sort((a, b) => {
    const av = a[key] as string | number | Date | null, bv = b[key] as string | number | Date | null;
    if (av === null || av === undefined) return 1;
    if (bv === null || bv === undefined) return -1;
    return (av < bv ? -1 : av > bv ? 1 : 0) * dir || a.name.localeCompare(b.name);
  });
  const total = items.length;
  const start = (p.page - 1) * p.pageSize;
  return { items: items.slice(start, start + p.pageSize), total, page: p.page, pageSize: p.pageSize, pages: Math.max(1, Math.ceil(total / p.pageSize)), counts: summarize(items) };
}

function summarize(items: LicenseView[]) {
  const by: Record<LicenseState, number> = { ok: 0, over: 0, expiring: 0, expired: 0, unmatched: 0 };
  let seats = 0, installed = 0, annualCost = 0;
  for (const i of items) { by[i.state]++; seats += i.seats ?? 0; installed += i.installed; annualCost += i.cost ?? 0; }
  return { total: items.length, byState: by, seats, installed, cost: annualCost };
}

export async function licenseCounts(orgId: string, siteIds?: string[]) {
  const r = await listLicenses({ orgId, page: 1, pageSize: 500, siteIds });
  return r.counts;
}

export async function getLicense(orgId: string, id: string, siteIds?: string[]) {
  const db = await getDb();
  const [row] = await db.select().from(lic).where(and(eq(lic.id, id), eq(lic.orgId, orgId)));
  if (!row) return null;
  const counts = await installCounts(orgId, [row], siteIds);
  let devices: { deviceId: string; deviceName: string; platform: string; deviceStatus: string; name: string; version: string | null; firstSeenAt: Date }[] = [];
  if (row.matchName) {
    const where: SQL[] = [eq(sw.orgId, orgId), isNull(sw.removedAt), ilike(sw.name, likePattern(row.matchName)), sql`${d.status} <> 'decommissioned'`];
    if (siteIds?.length) where.push(inArray(d.siteId, siteIds));
    devices = await db.select({ deviceId: sw.deviceId, deviceName: d.name, platform: d.platform, deviceStatus: d.status, name: sw.name, version: sw.version, firstSeenAt: sw.firstSeenAt }).from(sw).innerJoin(d, eq(d.id, sw.deviceId)).where(and(...where)).orderBy(asc(d.name)).limit(500);
  }
  return { license: toView(row, counts[row.id] ?? 0), devices };
}

function toRow(body: LicenseBody | LicensePatch) {
  const { key, purchaseDate, expiresAt, ...rest } = body as LicensePatch;
  const row: Partial<typeof lic.$inferInsert> = { ...rest };
  delete (row as { clearKey?: boolean }).clearKey;
  if (key !== undefined) row.keyEnc = key ? encryptSecret(key, "licenses") : null;
  if (purchaseDate !== undefined) row.purchaseDate = purchaseDate ? new Date(purchaseDate) : null;
  if (expiresAt !== undefined) row.expiresAt = expiresAt ? new Date(expiresAt) : null;
  return row;
}

export async function createLicense(orgId: string, body: LicenseBody) {
  const db = await getDb();
  const [row] = await db.insert(lic).values({ ...(toRow(body) as typeof lic.$inferInsert), orgId, name: body.name }).returning();
  bus.publish("software.license.updated", { id: row.id, name: row.name, action: "created" }, { orgId });
  return toView(row, 0);
}

export async function updateLicense(orgId: string, id: string, body: LicensePatch) {
  const db = await getDb();
  const patch = toRow(body);
  if (body.clearKey) patch.keyEnc = null;
  const [row] = await db.update(lic).set(patch).where(and(eq(lic.id, id), eq(lic.orgId, orgId))).returning();
  if (!row) return null;
  bus.publish("software.license.updated", { id: row.id, name: row.name, action: "updated" }, { orgId });
  return toView(row, 0);
}

export async function deleteLicense(orgId: string, id: string) {
  const db = await getDb();
  const [row] = await db.delete(lic).where(and(eq(lic.id, id), eq(lic.orgId, orgId))).returning();
  if (row) bus.publish("software.license.updated", { id: row.id, name: row.name, action: "deleted" }, { orgId });
  return row ?? null;
}

/** Decrypt the key. Callers audit this. */
export async function revealLicenseKey(orgId: string, id: string): Promise<{ name: string; key: string | null } | null> {
  const db = await getDb();
  const [row] = await db.select({ name: lic.name, keyEnc: lic.keyEnc }).from(lic).where(and(eq(lic.id, id), eq(lic.orgId, orgId)));
  if (!row) return null;
  return { name: row.name, key: row.keyEnc ? decryptSecret(row.keyEnc, "licenses") : null };
}
