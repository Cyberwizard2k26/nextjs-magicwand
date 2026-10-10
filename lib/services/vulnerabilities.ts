/**
 * Vulnerabilities: one row per (device, CVE, package). Rows come from three sources: patches that carry CVE ids
 * (materialised lazily by `syncFromPatches`, memoised 5 minutes per org), scanner exports imported as JSON/CSV and
 * the known-exploited list kept in the settings table (`vuln:kev:<orgId>`). Plain Drizzle; no Next.js imports.
 */
import { and, asc, desc, eq, ilike, inArray, isNotNull, or, sql, type SQL } from "drizzle-orm";
import { getDb, schema } from "../db";
import { bus } from "../bus";
import { getSetting, setSetting } from "./settings";
import { likePattern } from "./software-inventory";
import type { VulnImportRow, VulnSeverity, VulnStatus } from "../api/contracts/vulnerabilities";

const v = schema.vulnerabilities;
const d = schema.devices;
const p = schema.patches;

export const SEVERITY_ORDER: VulnSeverity[] = ["critical", "high", "medium", "low", "unknown"];
const SEV_RANK = sql`case ${v.severity} when 'critical' then 0 when 'high' then 1 when 'medium' then 2 when 'low' then 3 else 4 end`;
const CVE_RE = /^CVE-\d{4}-\d{4,}$/i;

/* ------------------------------------------------------------------ pure helpers (unit tested) */

export function severityFromCvss(cvss: number | null | undefined): VulnSeverity {
  if (cvss === null || cvss === undefined || Number.isNaN(cvss)) return "unknown";
  if (cvss >= 9) return "critical";
  if (cvss >= 7) return "high";
  if (cvss >= 4) return "medium";
  if (cvss > 0) return "low";
  return "unknown";
}

/** Scanner severities come in many spellings; fall back to the CVSS band. */
export function normalizeSeverity(sev: string | null | undefined, cvss?: number | null): VulnSeverity {
  const s = (sev ?? "").trim().toLowerCase();
  if (s === "critical" || s === "crit") return "critical";
  if (s === "high" || s === "important" || s === "severe") return "high";
  if (s === "medium" || s === "moderate" || s === "med") return "medium";
  if (s === "low" || s === "minor" || s === "negligible") return "low";
  return severityFromCvss(cvss);
}

export function patchSeverityToVuln(s: string | null | undefined): VulnSeverity {
  switch (s) {
    case "critical": return "critical";
    case "important": return "high";
    case "moderate": return "medium";
    case "low": return "low";
    default: return "unknown";
  }
}

export function normalizeCve(id: string): string | null {
  const t = id.trim().toUpperCase();
  return CVE_RE.test(t) ? t : null;
}

/** Minimal RFC 4180 parser: quotes, escaped quotes, CRLF. Returns rows of cells. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], cell = "", quoted = false;
  const src = text.replace(/^﻿/, "");
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"') { if (src[i + 1] === '"') { cell += '"'; i++; } else quoted = false; }
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") { row.push(cell); cell = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      row.push(cell); cell = "";
      if (row.some((c) => c.trim() !== "")) rows.push(row);
      row = [];
    } else cell += ch;
  }
  row.push(cell);
  if (row.some((c) => c.trim() !== "")) rows.push(row);
  return rows;
}

const HEADER_ALIASES: Record<string, keyof VulnImportRow> = {
  cve: "cveId", cveid: "cveId", cve_id: "cveId", "cve id": "cveId", vulnerability: "cveId", vulnerabilityid: "cveId", "vulnerability id": "cveId", id: "cveId",
  title: "title", name: "title", summary: "title", description: "title", vulnerabilityname: "title", "vulnerability name": "title",
  severity: "severity", risk: "severity", "risk level": "severity",
  cvss: "cvss", cvss3: "cvss", cvssscore: "cvss", "cvss score": "cvss", cvss_score: "cvss", "cvss v3": "cvss", cvssv3: "cvss", "cvss3 score": "cvss",
  epss: "epss", "epss score": "epss",
  package: "packageName", packagename: "packageName", package_name: "packageName", "package name": "packageName", component: "packageName", product: "packageName", software: "packageName", application: "packageName",
  installedversion: "installedVersion", installed_version: "installedVersion", "installed version": "installedVersion", version: "installedVersion", "current version": "installedVersion",
  fixedversion: "fixedVersion", fixed_version: "fixedVersion", "fixed version": "fixedVersion", fix: "fixedVersion", "fixed in": "fixedVersion", fixedin: "fixedVersion", solution: "fixedVersion", "patched version": "fixedVersion",
  deviceid: "deviceId", device_id: "deviceId", "device id": "deviceId",
  hostname: "hostname", host: "hostname", device: "hostname", asset: "hostname", "asset name": "hostname", computer: "hostname", machine: "hostname", "host name": "hostname", endpoint: "hostname",
  kev: "knownExploited", knownexploited: "knownExploited", known_exploited: "knownExploited", "known exploited": "knownExploited", exploited: "knownExploited", "cisa kev": "knownExploited",
  references: "references", reference: "references", url: "references", link: "references", links: "references",
};

/** CSV text -> loosely typed rows (validated by the route with `VulnImportRow`). */
export function parseVulnCsv(text: string): { rows: Record<string, unknown>[]; unknownColumns: string[]; errors: string[] } {
  const table = parseCsv(text);
  if (!table.length) return { rows: [], unknownColumns: [], errors: ["CSV is empty"] };
  const header = table[0].map((h) => h.trim().toLowerCase().replace(/[-]+/g, " ").replace(/\s+/g, " "));
  const keys = header.map((h) => HEADER_ALIASES[h] ?? HEADER_ALIASES[h.replace(/ /g, "")] ?? null);
  const unknownColumns = header.filter((_, i) => !keys[i]);
  if (!keys.includes("cveId")) return { rows: [], unknownColumns, errors: ["No CVE column found (expected a header like cveId, cve or CVE ID)"] };
  const rows: Record<string, unknown>[] = [];
  for (const cells of table.slice(1)) {
    const obj: Record<string, unknown> = {};
    keys.forEach((k, i) => {
      if (!k) return;
      const raw = (cells[i] ?? "").trim();
      if (raw === "") return;
      if (k === "knownExploited") obj[k] = /^(1|true|yes|y|known)$/i.test(raw);
      else if (k === "references") obj[k] = [...((obj[k] as string[] | undefined) ?? []), ...raw.split(/[\s;|]+/).filter(Boolean)];
      else if (k === "cvss" || k === "epss") { const n = Number.parseFloat(raw); if (!Number.isNaN(n)) obj[k] = n; }
      else obj[k] = raw;
    });
    if (Object.keys(obj).length) rows.push(obj);
  }
  return { rows, unknownColumns, errors: [] };
}

/** Group device rows by CVE the way the list endpoint does (pure, used by tests and the detail header). */
export function aggregateCve(rows: { cveId: string; title: string | null; severity: VulnSeverity; cvss: number | null; epss: number | null; knownExploited: boolean; fixedVersion: string | null; packageName: string | null; status: string; deviceId: string; detectedAt: Date }[]) {
  const first = rows[0];
  const rank = (s: VulnSeverity) => SEVERITY_ORDER.indexOf(s);
  const severity = rows.reduce<VulnSeverity>((acc, r) => (rank(r.severity) < rank(acc) ? r.severity : acc), "unknown");
  const statuses: Record<string, number> = {};
  for (const r of rows) statuses[r.status] = (statuses[r.status] ?? 0) + 1;
  return {
    cveId: first.cveId,
    title: rows.find((r) => r.title)?.title ?? null,
    severity,
    cvss: rows.reduce<number | null>((m, r) => (r.cvss !== null && (m === null || r.cvss > m) ? r.cvss : m), null),
    epss: rows.reduce<number | null>((m, r) => (r.epss !== null && (m === null || r.epss > m) ? r.epss : m), null),
    knownExploited: rows.some((r) => r.knownExploited),
    fixAvailable: rows.some((r) => !!r.fixedVersion),
    devices: new Set(rows.map((r) => r.deviceId)).size,
    openDevices: new Set(rows.filter((r) => r.status === "open").map((r) => r.deviceId)).size,
    packages: [...new Set(rows.map((r) => r.packageName).filter(Boolean))] as string[],
    statuses,
    firstDetectedAt: rows.reduce((m, r) => (r.detectedAt < m ? r.detectedAt : m), first.detectedAt),
  };
}

/* ------------------------------------------------------------------ patches -> CVE sync */

interface SyncResult { created: number; updated: number; resolved: number; patchesWithCves: number; at: string; skipped?: boolean }
interface VulnGlobal { __mwVulnSync?: Map<string, SyncResult> }
const g = globalThis as unknown as VulnGlobal;
const memo = () => (g.__mwVulnSync ??= new Map());
export const SYNC_TTL_MS = 5 * 60_000;

type UpsertRow = typeof v.$inferInsert;

const KEEP_STATUSES = ["accepted", "false_positive", "mitigated"];
const keepStatusSql = sql`case when ${v.status} in ('accepted','false_positive','mitigated') then ${v.status} else 'open' end`;
const keepResolvedSql = sql`case when ${v.status} in ('accepted','false_positive','mitigated') then ${v.resolvedAt} else null end`;

function dedupe(rows: UpsertRow[]): UpsertRow[] {
  const seen = new Map<string, UpsertRow>();
  for (const r of rows) seen.set(`${r.deviceId}\u0000${r.cveId}\u0000${r.packageName ?? ""}`, r);
  return [...seen.values()];
}

async function upsertRows(rows: UpsertRow[], since: Date, extraSet: Record<string, SQL> = {}) {
  const db = await getDb();
  let created = 0, updated = 0;
  for (let i = 0; i < rows.length; i += 200) {
    const batch = rows.slice(i, i + 200);
    const res = await db
      .insert(v)
      .values(batch)
      .onConflictDoUpdate({
        target: [v.deviceId, v.cveId, v.packageName],
        set: { title: sql`coalesce(excluded.title, ${v.title})`, severity: sql`excluded.severity`, installedVersion: sql`coalesce(excluded.installed_version, ${v.installedVersion})`, fixedVersion: sql`coalesce(excluded.fixed_version, ${v.fixedVersion})`, references: sql`excluded."references"`, data: sql`${v.data} || excluded.data`, status: keepStatusSql, resolvedAt: keepResolvedSql, ...extraSet },
      })
      .returning({ detectedAt: v.detectedAt });
    for (const r of res) if (r.detectedAt.getTime() >= since.getTime()) created++; else updated++;
  }
  return { created, updated };
}

/** Materialise vulnerability rows from patches that carry CVE ids; resolve rows whose patch got installed. */
export async function syncFromPatches(orgId: string, force = false): Promise<SyncResult> {
  const last = memo().get(orgId);
  if (!force && last && Date.now() - new Date(last.at).getTime() < SYNC_TTL_MS) return { ...last, skipped: true };
  const db = await getDb();
  const now = new Date();
  const rows = await db
    .select({ id: p.id, deviceId: p.deviceId, externalId: p.externalId, title: p.title, severity: p.severity, version: p.version, currentVersion: p.currentVersion, status: p.status, cveIds: p.cveIds, source: p.source, kb: p.kb, supportUrl: p.supportUrl })
    .from(p)
    .where(and(eq(p.orgId, orgId), sql`jsonb_array_length(${p.cveIds}) > 0`));
  const OUTSTANDING = new Set(["available", "approved", "rejected", "deferred", "scheduled", "downloading", "installing", "failed", "pending_reboot"]);
  const upserts: UpsertRow[] = [];
  const done: { deviceId: string; cveId: string; packageName: string }[] = [];
  for (const r of rows) {
    for (const raw of r.cveIds) {
      const cveId = normalizeCve(String(raw));
      if (!cveId) continue;
      if (OUTSTANDING.has(r.status)) {
        upserts.push({ orgId, deviceId: r.deviceId, cveId, title: r.title, severity: patchSeverityToVuln(r.severity), packageName: r.externalId, installedVersion: r.currentVersion, fixedVersion: r.version, source: r.source === "windows_update" || r.source === "wsus" ? "msrc" : "agent", status: "open", detectedAt: now, references: r.supportUrl ? [r.supportUrl] : [], data: { patchExternalId: r.externalId, patchId: r.id, kb: r.kb, patchStatus: r.status, syncedAt: now.toISOString() } });
      } else done.push({ deviceId: r.deviceId, cveId, packageName: r.externalId });
    }
  }
  const { created, updated } = await upsertRows(dedupe(upserts), now);
  let resolved = 0;
  for (let i = 0; i < done.length; i += 100) {
    const batch = done.slice(i, i + 100);
    const res = await db
      .update(v)
      .set({ status: "resolved", resolvedAt: now, data: sql`${v.data} || ${JSON.stringify({ resolvedBy: "patch installed", resolvedAt: now.toISOString() })}::jsonb` })
      .where(and(eq(v.orgId, orgId), eq(v.status, "open"), inArray(v.source, ["agent", "msrc"]), or(...batch.map((b) => and(eq(v.deviceId, b.deviceId), eq(v.cveId, b.cveId), eq(v.packageName, b.packageName))!))!))
      .returning({ id: v.id });
    resolved += res.length;
  }
  await applyKev(orgId);
  const result: SyncResult = { created, updated, resolved, patchesWithCves: rows.length, at: now.toISOString() };
  memo().set(orgId, result);
  if (created || resolved) bus.publish("vulnerabilities.synced", result, { orgId });
  return result;
}

/* ------------------------------------------------------------------ import */

export interface ImportResult { imported: number; updated: number; devicesMatched: number; skipped: { cveId?: string; hostname?: string; deviceId?: string; reason: string }[] }

export async function importVulnerabilities(orgId: string, rows: VulnImportRow[], source: UpsertRow["source"], siteIds?: string[]): Promise<ImportResult> {
  const db = await getDb();
  const where: SQL[] = [eq(d.orgId, orgId), sql`${d.status} <> 'decommissioned'`];
  if (siteIds?.length) where.push(inArray(d.siteId, siteIds));
  const devices = await db.select({ id: d.id, hostname: d.hostname, name: d.name }).from(d).where(and(...where));
  const byId = new Map(devices.map((x) => [x.id, x]));
  const byHost = new Map<string, (typeof devices)[number]>();
  for (const x of devices) { if (x.hostname) byHost.set(x.hostname.toLowerCase(), x); byHost.set(x.name.toLowerCase(), x); if (x.hostname?.includes(".")) byHost.set(x.hostname.split(".")[0].toLowerCase(), x); }
  const now = new Date();
  const upserts: UpsertRow[] = [];
  const skipped: ImportResult["skipped"] = [];
  const matched = new Set<string>();
  for (const r of rows) {
    const device = r.deviceId ? byId.get(r.deviceId) : r.hostname ? byHost.get(r.hostname.toLowerCase()) ?? byHost.get(r.hostname.split(".")[0].toLowerCase()) : undefined;
    if (!device) { skipped.push({ cveId: r.cveId, hostname: r.hostname, deviceId: r.deviceId, reason: r.deviceId || r.hostname ? "device not found in this organization" : "deviceId or hostname is required" }); continue; }
    matched.add(device.id);
    upserts.push({ orgId, deviceId: device.id, cveId: r.cveId, title: r.title ?? null, severity: normalizeSeverity(r.severity, r.cvss), cvss: r.cvss ?? null, epss: r.epss ?? null, knownExploited: r.knownExploited ?? false, packageName: r.packageName ?? "", installedVersion: r.installedVersion ?? null, fixedVersion: r.fixedVersion ?? null, source, status: "open", detectedAt: now, references: r.references ?? [], data: { importedAt: now.toISOString() } });
  }
  const { created, updated } = await upsertRows(dedupe(upserts), now, { cvss: sql`coalesce(excluded.cvss, ${v.cvss})`, epss: sql`coalesce(excluded.epss, ${v.epss})`, knownExploited: sql`${v.knownExploited} or excluded.known_exploited` });
  await applyKev(orgId);
  if (created || updated) bus.publish("vulnerabilities.imported", { created, updated, devices: matched.size, source }, { orgId });
  return { imported: created, updated, devicesMatched: matched.size, skipped };
}

/* ------------------------------------------------------------------ known exploited list */

const kevKey = (orgId: string) => `vuln:kev:${orgId}`;

export async function getKev(orgId: string): Promise<{ cveIds: string[]; updatedAt: string | null }> {
  const s = await getSetting<{ cveIds?: string[]; updatedAt?: string }>(kevKey(orgId), {});
  return { cveIds: Array.isArray(s?.cveIds) ? s.cveIds : [], updatedAt: s?.updatedAt ?? null };
}

export async function setKev(orgId: string, cveIds: string[], replace: boolean) {
  const current = replace ? [] : (await getKev(orgId)).cveIds;
  const next = [...new Set([...current, ...cveIds.map((c) => normalizeCve(c)).filter((c): c is string => !!c)])].sort();
  const updatedAt = new Date().toISOString();
  await setSetting(kevKey(orgId), { cveIds: next, updatedAt });
  const flagged = await applyKev(orgId);
  bus.publish("vulnerabilities.kev.updated", { count: next.length, flagged }, { orgId });
  return { cveIds: next, updatedAt, flagged };
}

/** Flag rows whose CVE is on the list (and unflag rows previously flagged by the list only). */
export async function applyKev(orgId: string): Promise<number> {
  const db = await getDb();
  const { cveIds } = await getKev(orgId);
  await db.update(v).set({ knownExploited: false, data: sql`${v.data} - 'kevSource'` }).where(and(eq(v.orgId, orgId), eq(v.knownExploited, true), sql`${v.data}->>'kevSource' = 'list'`, cveIds.length ? sql`${v.cveId} <> all(${sql`array[${sql.join(cveIds.map((c) => sql`${c}::text`), sql`, `)}]`})` : sql`true`));
  if (!cveIds.length) return 0;
  let flagged = 0;
  for (let i = 0; i < cveIds.length; i += 500) {
    const res = await db.update(v).set({ knownExploited: true, data: sql`${v.data} || '{"kevSource":"list"}'::jsonb` }).where(and(eq(v.orgId, orgId), inArray(v.cveId, cveIds.slice(i, i + 500)), eq(v.knownExploited, false))).returning({ id: v.id });
    flagged += res.length;
  }
  return flagged;
}

/* ------------------------------------------------------------------ queries */

export interface VulnListParams {
  orgId: string; q?: string; severity?: string[]; status?: string[]; kev?: boolean; fixAvailable?: boolean; deviceId?: string; siteId?: string; siteIds?: string[]; platform?: string[]; source?: string[]; packageName?: string; sort?: string; dir?: "asc" | "desc"; page: number; pageSize: number;
}

function listWhere(pr: VulnListParams): SQL[] {
  const where: SQL[] = [eq(v.orgId, pr.orgId), sql`${d.status} <> 'decommissioned'`];
  const statuses = pr.status?.length ? pr.status : ["open"];
  if (!statuses.includes("all")) where.push(inArray(v.status, statuses as VulnStatus[]));
  if (pr.severity?.length) where.push(inArray(v.severity, pr.severity as VulnSeverity[]));
  if (pr.kev) where.push(eq(v.knownExploited, true));
  if (pr.fixAvailable) where.push(isNotNull(v.fixedVersion));
  if (pr.deviceId) where.push(eq(v.deviceId, pr.deviceId));
  if (pr.siteId) where.push(eq(d.siteId, pr.siteId));
  if (pr.siteIds?.length) where.push(inArray(d.siteId, pr.siteIds));
  if (pr.platform?.length) where.push(inArray(d.platform, pr.platform as (typeof d.$inferSelect.platform)[]));
  if (pr.source?.length) where.push(inArray(v.source, pr.source as (typeof v.$inferSelect.source)[]));
  if (pr.packageName) where.push(ilike(v.packageName, likePattern(pr.packageName)));
  if (pr.q) { const like = likePattern(pr.q); where.push(or(ilike(v.cveId, like), ilike(v.title, like), ilike(v.packageName, like), ilike(d.name, like))!); }
  return where;
}

/** CVEs grouped across the fleet. */
export async function listVulnerabilities(pr: VulnListParams) {
  const db = await getDb();
  const where = listWhere(pr);
  const devicesExpr = sql`count(distinct ${v.deviceId})`;
  const [{ total }] = await db.select({ total: sql<number>`count(distinct ${v.cveId})::int` }).from(v).innerJoin(d, eq(d.id, v.deviceId)).where(and(...where));
  const order: SQL[] = (() => {
    const dir = pr.dir ?? "desc";
    switch (pr.sort) {
      case "severity": return [sql`min(${SEV_RANK}) ${dir === "asc" ? sql`desc` : sql`asc`}`, sql`${devicesExpr} desc`];
      case "cvss": return [sql`max(${v.cvss}) ${dir === "asc" ? sql`asc nulls first` : sql`desc nulls last`}`];
      case "devices": return [dir === "asc" ? asc(devicesExpr) : desc(devicesExpr)];
      case "detectedAt": return [dir === "asc" ? sql`min(${v.detectedAt}) asc` : sql`min(${v.detectedAt}) desc`];
      case "cveId": return [dir === "asc" ? asc(v.cveId) : desc(v.cveId)];
      default: return [sql`bool_or(${v.knownExploited}) desc`, sql`min(${SEV_RANK}) asc`, sql`max(${v.cvss}) desc nulls last`, sql`${devicesExpr} desc`, asc(v.cveId)];
    }
  })();
  const items = await db
    .select({
      cveId: v.cveId,
      title: sql<string | null>`min(${v.title})`,
      severity: sql<VulnSeverity>`(array['critical','high','medium','low','unknown'])[min(${SEV_RANK}) + 1]`,
      cvss: sql<number | null>`max(${v.cvss})`,
      epss: sql<number | null>`max(${v.epss})`,
      knownExploited: sql<boolean>`bool_or(${v.knownExploited})`,
      fixAvailable: sql<boolean>`bool_or(${v.fixedVersion} is not null)`,
      devices: sql<number>`count(distinct ${v.deviceId})::int`,
      openDevices: sql<number>`count(distinct ${v.deviceId}) filter (where ${v.status} = 'open')::int`,
      packages: sql<string[]>`jsonb_agg(distinct ${v.packageName})`,
      sources: sql<string[]>`jsonb_agg(distinct ${v.source})`,
      platforms: sql<string[]>`jsonb_agg(distinct ${d.platform})`,
      firstDetectedAt: sql<Date>`min(${v.detectedAt})`,
      lastDetectedAt: sql<Date>`max(${v.detectedAt})`,
      ageDays: sql<number>`floor(extract(epoch from now() - min(${v.detectedAt})) / 86400)::int`,
    })
    .from(v)
    .innerJoin(d, eq(d.id, v.deviceId))
    .where(and(...where))
    .groupBy(v.cveId)
    .orderBy(...order)
    .limit(pr.pageSize)
    .offset((pr.page - 1) * pr.pageSize);
  return { items: items.map((i) => ({ ...i, packages: (i.packages ?? []).filter(Boolean) })), total, page: pr.page, pageSize: pr.pageSize, pages: Math.max(1, Math.ceil(total / pr.pageSize)) };
}

export async function vulnSummary(orgId: string, siteIds?: string[]) {
  const db = await getDb();
  const scope: SQL[] = [eq(v.orgId, orgId), sql`${d.status} <> 'decommissioned'`];
  if (siteIds?.length) scope.push(inArray(d.siteId, siteIds));
  const open = and(...scope, eq(v.status, "open"));
  const bySev = await db.select({ severity: v.severity, cves: sql<number>`count(distinct ${v.cveId})::int`, instances: sql<number>`count(*)::int`, devices: sql<number>`count(distinct ${v.deviceId})::int` }).from(v).innerJoin(d, eq(d.id, v.deviceId)).where(open).groupBy(v.severity);
  const [agg] = await db
    .select({
      cves: sql<number>`count(distinct ${v.cveId})::int`,
      instances: sql<number>`count(*)::int`,
      devicesAffected: sql<number>`count(distinct ${v.deviceId})::int`,
      kev: sql<number>`count(distinct ${v.cveId}) filter (where ${v.knownExploited})::int`,
      kevDevices: sql<number>`count(distinct ${v.deviceId}) filter (where ${v.knownExploited})::int`,
      fixAvailable: sql<number>`count(distinct ${v.cveId}) filter (where ${v.fixedVersion} is not null)::int`,
      meanAgeDays: sql<number | null>`round(avg(extract(epoch from now() - ${v.detectedAt})) / 86400)::int`,
      oldestDays: sql<number | null>`floor(max(extract(epoch from now() - ${v.detectedAt})) / 86400)::int`,
    })
    .from(v)
    .innerJoin(d, eq(d.id, v.deviceId))
    .where(open);
  const byStatus = await db.select({ status: v.status, n: sql<number>`count(*)::int` }).from(v).innerJoin(d, eq(d.id, v.deviceId)).where(and(...scope)).groupBy(v.status);
  const bySource = await db.select({ source: v.source, n: sql<number>`count(*)::int` }).from(v).innerJoin(d, eq(d.id, v.deviceId)).where(open).groupBy(v.source);
  const [{ devicesTotal }] = await db.select({ devicesTotal: sql<number>`count(*)::int` }).from(d).where(and(eq(d.orgId, orgId), sql`${d.status} <> 'decommissioned'`, siteIds?.length ? inArray(d.siteId, siteIds) : undefined));
  const [{ resolved30d }] = await db.select({ resolved30d: sql<number>`count(*)::int` }).from(v).innerJoin(d, eq(d.id, v.deviceId)).where(and(...scope, eq(v.status, "resolved"), sql`${v.resolvedAt} > now() - interval '30 days'`));
  const topPackages = await db.select({ packageName: v.packageName, cves: sql<number>`count(distinct ${v.cveId})::int`, devices: sql<number>`count(distinct ${v.deviceId})::int` }).from(v).innerJoin(d, eq(d.id, v.deviceId)).where(and(open, sql`coalesce(${v.packageName}, '') <> ''`)).groupBy(v.packageName).orderBy(desc(sql`count(distinct ${v.cveId})`)).limit(6);
  const topDevices = await db.select({ deviceId: v.deviceId, deviceName: d.name, platform: d.platform, cves: sql<number>`count(distinct ${v.cveId})::int`, critical: sql<number>`count(distinct ${v.cveId}) filter (where ${v.severity} = 'critical')::int`, kev: sql<number>`count(distinct ${v.cveId}) filter (where ${v.knownExploited})::int` }).from(v).innerJoin(d, eq(d.id, v.deviceId)).where(open).groupBy(v.deviceId, d.name, d.platform).orderBy(desc(sql`count(distinct ${v.cveId})`)).limit(6);
  const severity: Record<VulnSeverity, { cves: number; instances: number; devices: number }> = { critical: { cves: 0, instances: 0, devices: 0 }, high: { cves: 0, instances: 0, devices: 0 }, medium: { cves: 0, instances: 0, devices: 0 }, low: { cves: 0, instances: 0, devices: 0 }, unknown: { cves: 0, instances: 0, devices: 0 } };
  for (const r of bySev) severity[r.severity] = { cves: r.cves, instances: r.instances, devices: r.devices };
  const kevList = await getKev(orgId);
  const lastSync = memo().get(orgId) ?? null;
  return { ...agg, devicesTotal, resolved30d, severity, byStatus: Object.fromEntries(byStatus.map((r) => [r.status, r.n])), bySource: Object.fromEntries(bySource.map((r) => [r.source, r.n])), topPackages, topDevices, kevList: { count: kevList.cveIds.length, updatedAt: kevList.updatedAt }, lastSync };
}

/** One CVE: aggregated header plus every affected device row (with the patch mapped to it when known). */
export async function getVulnerability(orgId: string, cveId: string, siteIds?: string[]) {
  const db = await getDb();
  const where: SQL[] = [eq(v.orgId, orgId), eq(v.cveId, cveId), sql`${d.status} <> 'decommissioned'`];
  if (siteIds?.length) where.push(inArray(d.siteId, siteIds));
  const rows = await db
    .select({
      id: v.id, deviceId: v.deviceId, deviceName: d.name, platform: d.platform, deviceStatus: d.status, siteId: d.siteId, cveId: v.cveId, title: v.title, severity: v.severity, cvss: v.cvss, epss: v.epss, knownExploited: v.knownExploited, packageName: v.packageName, installedVersion: v.installedVersion, fixedVersion: v.fixedVersion, source: v.source, status: v.status, detectedAt: v.detectedAt, resolvedAt: v.resolvedAt, references: v.references, data: v.data,
      patchStatus: p.status, patchExternalId: p.externalId, patchTitle: p.title,
    })
    .from(v)
    .innerJoin(d, eq(d.id, v.deviceId))
    .leftJoin(p, and(eq(p.deviceId, v.deviceId), eq(p.orgId, orgId), eq(p.externalId, v.packageName)))
    .where(and(...where))
    .orderBy(sql`case ${v.status} when 'open' then 0 when 'mitigated' then 1 else 2 end`, asc(d.name));
  if (!rows.length) return null;
  const header = aggregateCve(rows);
  const references = [...new Set(rows.flatMap((r) => r.references))];
  const notes = rows.map((r) => (r.data as { note?: string }).note).filter(Boolean) as string[];
  return { cve: { ...header, references, remediable: rows.filter((r) => r.status === "open" && r.patchStatus && !["installed", "superseded", "not_applicable", "pending_reboot"].includes(r.patchStatus)).length, notes: [...new Set(notes)] }, devices: rows };
}

export async function updateVulnStatus(orgId: string, cveId: string, body: { status: VulnStatus; note?: string; deviceIds?: string[] }, actor: { id: string | null; name: string | null }) {
  const db = await getDb();
  const now = new Date();
  const entry = { status: body.status, note: body.note ?? null, at: now.toISOString(), by: actor.name };
  const where: SQL[] = [eq(v.orgId, orgId), eq(v.cveId, cveId)];
  if (body.deviceIds?.length) where.push(inArray(v.deviceId, body.deviceIds));
  const rows = await db
    .update(v)
    .set({
      status: body.status,
      resolvedAt: body.status === "resolved" ? now : body.status === "open" ? null : sql`${v.resolvedAt}`,
      data: sql`jsonb_set(${v.data} || ${JSON.stringify({ note: body.note ?? null, statusChangedAt: entry.at, statusChangedBy: actor.name })}::jsonb, '{history}', coalesce(${v.data}->'history', '[]'::jsonb) || ${JSON.stringify([entry])}::jsonb)`,
    })
    .where(and(...where))
    .returning({ id: v.id, deviceId: v.deviceId });
  if (rows.length) bus.publish("vulnerability.updated", { cveId, status: body.status, devices: rows.length, by: actor.name }, { orgId });
  return rows.length;
}

/** Which affected devices can be remediated through the patching pipeline, grouped by the patch ids they need. */
export async function remediationPlan(orgId: string, cveId: string, deviceIds?: string[], siteIds?: string[]) {
  const db = await getDb();
  const where: SQL[] = [eq(v.orgId, orgId), eq(v.cveId, cveId), eq(v.status, "open"), sql`${d.status} <> 'decommissioned'`];
  if (deviceIds?.length) where.push(inArray(v.deviceId, deviceIds));
  if (siteIds?.length) where.push(inArray(d.siteId, siteIds));
  const rows = await db
    .select({ deviceId: v.deviceId, deviceName: d.name, platform: d.platform, deviceStatus: d.status, externalId: p.externalId })
    .from(v)
    .innerJoin(d, eq(d.id, v.deviceId))
    .leftJoin(p, and(eq(p.deviceId, v.deviceId), eq(p.orgId, orgId), eq(p.externalId, v.packageName), inArray(p.status, ["available", "approved", "rejected", "deferred", "scheduled", "failed"])))
    .where(and(...where));
  const perDevice = new Map<string, { deviceId: string; deviceName: string; platform: string; deviceStatus: string; externalIds: Set<string> }>();
  for (const r of rows) {
    const e = perDevice.get(r.deviceId) ?? { deviceId: r.deviceId, deviceName: r.deviceName, platform: r.platform, deviceStatus: r.deviceStatus, externalIds: new Set<string>() };
    if (r.externalId) e.externalIds.add(r.externalId);
    perDevice.set(r.deviceId, e);
  }
  const groups = new Map<string, { externalIds: string[]; deviceIds: string[] }>();
  const noPatch: { deviceId: string; deviceName: string; platform: string }[] = [];
  for (const e of perDevice.values()) {
    if (!e.externalIds.size) { noPatch.push({ deviceId: e.deviceId, deviceName: e.deviceName, platform: e.platform }); continue; }
    const ids = [...e.externalIds].sort();
    const key = ids.join("|");
    const grp = groups.get(key) ?? { externalIds: ids, deviceIds: [] };
    grp.deviceIds.push(e.deviceId);
    groups.set(key, grp);
  }
  return { groups: [...groups.values()], noPatch, affected: perDevice.size };
}
