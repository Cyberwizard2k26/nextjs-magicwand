/**
 * Security centre: turns the raw posture the agent reports (device_security.posture) into a 0-100 score, a list of
 * weighted checks and findings; serves the fleet views (posture table, summary, findings feed) and queues posture
 * scans. Scores are persisted back into device_security so the device page and alerts agree. No Next.js imports.
 */
import { and, asc, desc, eq, inArray, isNotNull, isNull, or, sql, type SQL } from "drizzle-orm";
import { getDb, schema } from "../db";
import { bus } from "../bus";
import { createJob } from "./jobs";
import { likePattern, resolveScopedTargets, type TargetSpec } from "./software-inventory";
import type { SecurityPosture } from "../db/schema/devices";

const d = schema.devices;
const ds = schema.deviceSecurity;

export type CheckStatus = "pass" | "fail" | "unknown";
export type FindingSeverity = "low" | "medium" | "high" | "critical";
export type CheckCategory = "protection" | "encryption" | "hardening" | "exposure" | "identity" | "updates";
export interface PostureCheckDef {
  id: string;
  label: string;
  severity: FindingSeverity;
  weight: number;
  category: CheckCategory;
  /** Platforms the check applies to (undefined = all). */
  platforms?: string[];
  /** What a failing device should do. */
  remediation: string;
  evaluate: (p: SecurityPosture) => { status: CheckStatus; detail?: string };
}
export interface Finding { id: string; severity: FindingSeverity; title: string; detail?: string }
export interface PostureEvaluation {
  score: number | null;
  passed: number;
  failed: number;
  unknown: number;
  checks: { id: string; label: string; severity: FindingSeverity; category: CheckCategory; status: CheckStatus; detail?: string }[];
  findings: Finding[];
}

const bool = (v: unknown, detailTrue?: string, detailFalse?: string) => (v === undefined || v === null ? { status: "unknown" as CheckStatus } : v === true ? { status: "pass" as CheckStatus, detail: detailTrue } : { status: "fail" as CheckStatus, detail: detailFalse });
const inverted = (v: unknown, detailWhenEnabled: string) => (v === undefined || v === null ? { status: "unknown" as CheckStatus } : v === true ? { status: "fail" as CheckStatus, detail: detailWhenEnabled } : { status: "pass" as CheckStatus, detail: "disabled" });
export const RISKY_PORTS: Record<number, string> = { 21: "FTP", 23: "Telnet", 69: "TFTP", 135: "RPC", 139: "NetBIOS", 445: "SMB", 512: "rexec", 513: "rlogin", 514: "rsh", 1433: "SQL Server", 3306: "MySQL", 3389: "RDP", 5432: "PostgreSQL", 5900: "VNC", 5985: "WinRM", 6379: "Redis", 27017: "MongoDB" };
export const MAX_LOCAL_ADMINS = 2;

/** The posture dimensions the agent reports, weighted. Order is the display order. */
export const POSTURE_CHECKS: PostureCheckDef[] = [
  { id: "antivirus", label: "Antivirus enabled", severity: "critical", weight: 14, category: "protection", platforms: ["windows", "macos"], remediation: "Enable Microsoft Defender or the managed endpoint protection product and make sure real-time protection is on.", evaluate: (p) => (!p.antivirus?.length ? { status: "unknown" } : p.antivirus.some((a) => a.enabled) ? { status: "pass", detail: p.antivirus.filter((a) => a.enabled).map((a) => a.name).join(", ") } : { status: "fail", detail: `${p.antivirus.map((a) => a.name).join(", ")} disabled` }) },
  { id: "av_updated", label: "Antivirus definitions current", severity: "high", weight: 5, category: "protection", platforms: ["windows", "macos"], remediation: "Trigger a signature update; check the product's update channel if it keeps falling behind.", evaluate: (p) => (!p.antivirus?.length ? { status: "unknown" } : p.antivirus.some((a) => a.enabled && !a.upToDate) ? { status: "fail", detail: "definitions outdated" } : { status: "pass" }) },
  { id: "firewall", label: "Host firewall enabled", severity: "high", weight: 12, category: "protection", remediation: "Turn the host firewall on for every network profile (Windows Firewall, ufw/firewalld, macOS application firewall).", evaluate: (p) => bool(p.firewall?.enabled, p.firewall?.profiles ? Object.entries(p.firewall.profiles).filter(([, v]) => v).map(([k]) => k).join(", ") : undefined, "firewall off") },
  { id: "disk_encryption", label: "Disk encryption", severity: "high", weight: 14, category: "encryption", remediation: "Enable BitLocker / FileVault / LUKS on the system volume and escrow the recovery key.", evaluate: (p) => (!p.diskEncryption?.length ? { status: "unknown" } : p.diskEncryption.every((x) => x.encrypted) ? { status: "pass", detail: p.diskEncryption.map((x) => x.method).filter(Boolean).join(", ") || undefined } : { status: "fail", detail: `${p.diskEncryption.filter((x) => !x.encrypted).map((x) => x.volume).join(", ")} not encrypted` }) },
  { id: "secure_boot", label: "Secure Boot", severity: "medium", weight: 6, category: "hardening", remediation: "Enable Secure Boot in UEFI firmware settings.", evaluate: (p) => bool(p.secureBoot, undefined, "disabled") },
  { id: "tpm", label: "TPM available", severity: "low", weight: 3, category: "hardening", platforms: ["windows", "linux"], remediation: "Enable the TPM (fTPM/PTT) in firmware; required for BitLocker and Windows 11.", evaluate: (p) => bool(p.tpmEnabled, undefined, "no TPM") },
  { id: "uac", label: "User Account Control", severity: "high", weight: 6, category: "hardening", platforms: ["windows"], remediation: "Set EnableLUA=1 and ConsentPromptBehaviorAdmin to prompt.", evaluate: (p) => bool(p.uacEnabled, undefined, "UAC disabled") },
  { id: "auto_update", label: "Automatic updates", severity: "medium", weight: 8, category: "updates", remediation: "Enable automatic OS updates (Windows Update, unattended-upgrades, Software Update).", evaluate: (p) => bool(p.autoUpdateEnabled, undefined, "off") },
  { id: "screen_lock", label: "Screen lock", severity: "medium", weight: 5, category: "hardening", remediation: "Require a screen lock after at most 15 minutes of inactivity.", evaluate: (p) => (p.screenLockMinutes === undefined || p.screenLockMinutes === null ? { status: "unknown" } : p.screenLockMinutes > 0 && p.screenLockMinutes <= 15 ? { status: "pass", detail: `${p.screenLockMinutes} min` } : { status: "fail", detail: p.screenLockMinutes ? `${p.screenLockMinutes} min` : "never" }) },
  { id: "remote_desktop", label: "Remote desktop not exposed", severity: "high", weight: 6, category: "exposure", remediation: "Disable RDP / Screen Sharing or restrict it with the firewall and NLA; use the RMM remote session instead.", evaluate: (p) => inverted(p.remoteDesktopEnabled, "remote desktop enabled") },
  { id: "smbv1", label: "SMBv1 disabled", severity: "high", weight: 8, category: "exposure", platforms: ["windows"], remediation: "Disable-WindowsOptionalFeature -Online -FeatureName SMB1Protocol.", evaluate: (p) => inverted(p.smbV1Enabled, "SMBv1 enabled") },
  { id: "guest_account", label: "Guest account disabled", severity: "medium", weight: 4, category: "identity", platforms: ["windows", "macos"], remediation: "Disable the Guest account.", evaluate: (p) => inverted(p.guestAccountEnabled, "guest account enabled") },
  { id: "gatekeeper", label: "Gatekeeper", severity: "high", weight: 6, category: "protection", platforms: ["macos"], remediation: "spctl --master-enable.", evaluate: (p) => bool(p.gatekeeper, undefined, "disabled") },
  { id: "sip", label: "System Integrity Protection", severity: "critical", weight: 8, category: "hardening", platforms: ["macos"], remediation: "Re-enable SIP from Recovery (csrutil enable).", evaluate: (p) => bool(p.sip, undefined, "disabled") },
  { id: "ssh_root_login", label: "SSH root login disabled", severity: "high", weight: 8, category: "exposure", platforms: ["linux"], remediation: "Set PermitRootLogin no in sshd_config and restart sshd.", evaluate: (p) => inverted(p.sshRootLogin, "PermitRootLogin yes") },
  { id: "os_supported", label: "OS version supported", severity: "critical", weight: 10, category: "updates", remediation: "Upgrade to a supported OS release; unsupported versions receive no security fixes.", evaluate: (p) => bool(p.osSupported, undefined, "end of life") },
  { id: "local_admins", label: "Local administrators limited", severity: "medium", weight: 5, category: "identity", remediation: `Keep at most ${MAX_LOCAL_ADMINS} local administrators; demote the rest or manage them with password rotation.`, evaluate: (p) => (!p.localAdmins ? { status: "unknown" } : p.localAdmins.length <= MAX_LOCAL_ADMINS ? { status: "pass", detail: p.localAdmins.join(", ") || "none" } : { status: "fail", detail: `${p.localAdmins.length} admins: ${p.localAdmins.slice(0, 5).join(", ")}${p.localAdmins.length > 5 ? "…" : ""}` }) },
  { id: "risky_ports", label: "No risky listening ports", severity: "medium", weight: 5, category: "exposure", remediation: "Stop or firewall legacy/remote services (Telnet, FTP, VNC, SMB, database ports) that do not need to listen.", evaluate: (p) => { if (!p.openPorts) return { status: "unknown" }; const hits = p.openPorts.filter((o) => RISKY_PORTS[o.port]); return hits.length ? { status: "fail", detail: hits.map((h) => `${RISKY_PORTS[h.port]} ${h.proto}/${h.port}`).join(", ") } : { status: "pass", detail: `${p.openPorts.length} listeners` }; } },
  { id: "edr", label: "Endpoint detection & response", severity: "medium", weight: 4, category: "protection", remediation: "Deploy the EDR agent the organization standardised on.", evaluate: (p) => (!p.edr ? { status: "unknown" } : p.edr.length && p.edr.some((e) => /running|active|healthy|ok|protected/i.test(e.status)) ? { status: "pass", detail: p.edr.map((e) => e.name).join(", ") } : { status: "fail", detail: p.edr.length ? p.edr.map((e) => `${e.name}: ${e.status}`).join(", ") : "none" }) },
];
export const CHECK_BY_ID = new Map(POSTURE_CHECKS.map((c) => [c.id, c]));

/** Pure: evaluate posture for one device. Unknown checks neither count for nor against the score. */
export function evaluatePosture(posture: SecurityPosture | null | undefined, platform: string): PostureEvaluation {
  const p = posture ?? {};
  let passW = 0, totalW = 0, passed = 0, failed = 0, unknown = 0;
  const checks: PostureEvaluation["checks"] = [];
  const findings: Finding[] = [];
  for (const c of POSTURE_CHECKS) {
    if (c.platforms && !c.platforms.includes(platform)) continue;
    const r = c.evaluate(p);
    checks.push({ id: c.id, label: c.label, severity: c.severity, category: c.category, status: r.status, detail: r.detail });
    if (r.status === "unknown") { unknown++; continue; }
    totalW += c.weight;
    if (r.status === "pass") { passed++; passW += c.weight; }
    else { failed++; findings.push({ id: c.id, severity: c.severity, title: c.label, detail: r.detail }); }
  }
  return { score: totalW ? Math.round((passW / totalW) * 100) : null, passed, failed, unknown, checks, findings };
}

export function scoreBand(score: number | null | undefined): "excellent" | "good" | "fair" | "poor" | "unknown" {
  if (score === null || score === undefined) return "unknown";
  return score >= 90 ? "excellent" : score >= 75 ? "good" : score >= 50 ? "fair" : "poor";
}

/* ------------------------------------------------------------------ persistence */

interface SecGlobal { __mwScoreRefresh?: Map<string, number> }
const g = globalThis as unknown as SecGlobal;
const refreshMemo = () => (g.__mwScoreRefresh ??= new Map());

/** Recompute and persist score/findings for devices whose stored values drifted. Memoised 60 s per org. */
export async function refreshPostureScores(orgId: string, force = false) {
  const last = refreshMemo().get(orgId) ?? 0;
  if (!force && Date.now() - last < 60_000) return 0;
  const db = await getDb();
  const rows = await db.select({ deviceId: ds.deviceId, posture: ds.posture, score: ds.score, findings: ds.findings, updatedAt: ds.updatedAt, platform: d.platform }).from(ds).innerJoin(d, eq(d.id, ds.deviceId)).where(eq(d.orgId, orgId));
  let changed = 0;
  for (const r of rows) {
    const ev = evaluatePosture(r.posture, r.platform);
    if (ev.score === r.score && JSON.stringify(ev.findings) === JSON.stringify(r.findings)) continue;
    await db.update(ds).set({ score: ev.score, findings: ev.findings, updatedAt: r.updatedAt }).where(eq(ds.deviceId, r.deviceId));
    changed++;
    if (r.score !== null && ev.score !== null && ev.score < r.score) bus.publish("security.score_dropped", { deviceId: r.deviceId, from: r.score, to: ev.score }, { orgId, deviceId: r.deviceId });
  }
  refreshMemo().set(orgId, Date.now());
  return changed;
}

/* ------------------------------------------------------------------ fleet queries */

export interface PostureListParams { orgId: string; q?: string; platform?: string[]; siteId?: string; siteIds?: string[]; status?: string[]; scoreBelow?: number; failing?: string; collected?: boolean; sort?: string; dir?: "asc" | "desc"; page: number; pageSize: number }

function deviceScope(orgId: string, siteIds?: string[], siteId?: string): SQL[] {
  const where: SQL[] = [eq(d.orgId, orgId), sql`${d.status} <> 'decommissioned'`];
  if (siteIds?.length) where.push(inArray(d.siteId, siteIds));
  if (siteId) where.push(eq(d.siteId, siteId));
  return where;
}

export function postureFlags(p: SecurityPosture | null | undefined) {
  const x = p ?? {};
  return {
    antivirus: x.antivirus?.length ? x.antivirus.some((a) => a.enabled) : null,
    firewall: x.firewall?.enabled ?? null,
    encryption: x.diskEncryption?.length ? x.diskEncryption.every((v) => v.encrypted) : null,
    autoUpdate: x.autoUpdateEnabled ?? null,
    secureBoot: x.secureBoot ?? null,
    remoteDesktop: x.remoteDesktopEnabled ?? null,
    localAdmins: x.localAdmins?.length ?? null,
    openPorts: x.openPorts?.length ?? null,
  };
}

export async function listPosture(pr: PostureListParams) {
  await refreshPostureScores(pr.orgId);
  const db = await getDb();
  const where = deviceScope(pr.orgId, pr.siteIds, pr.siteId);
  if (pr.platform?.length) where.push(inArray(d.platform, pr.platform as (typeof d.$inferSelect.platform)[]));
  if (pr.status?.length) where.push(inArray(d.status, pr.status as (typeof d.$inferSelect.status)[]));
  if (pr.scoreBelow !== undefined) where.push(sql`${ds.score} < ${pr.scoreBelow}`);
  if (pr.failing) where.push(sql`${ds.findings} @> ${JSON.stringify([{ id: pr.failing }])}::jsonb`);
  if (pr.collected === true) where.push(isNotNull(ds.deviceId));
  if (pr.collected === false) where.push(isNull(ds.deviceId));
  if (pr.q) { const like = likePattern(pr.q); where.push(or(sql`${d.name} ilike ${like}`, sql`${d.hostname} ilike ${like}`, sql`${d.loggedInUser} ilike ${like}`, sql`${d.osName} ilike ${like}`, sql`${ds.findings}::text ilike ${like}`)!); }
  const dir = pr.dir ?? (pr.sort === "name" ? "asc" : pr.sort === "score" ? "asc" : "desc");
  const order: SQL[] = pr.sort === "name" ? [dir === "asc" ? asc(d.name) : desc(d.name)] : pr.sort === "findings" ? [sql`jsonb_array_length(coalesce(${ds.findings}, '[]'::jsonb)) ${dir === "asc" ? sql`asc` : sql`desc`}`] : pr.sort === "updatedAt" ? [sql`${ds.updatedAt} ${dir === "asc" ? sql`asc nulls first` : sql`desc nulls last`}`] : pr.sort === "lastSeenAt" ? [sql`${d.lastSeenAt} ${dir === "asc" ? sql`asc nulls first` : sql`desc nulls last`}`] : [sql`${ds.score} ${dir === "asc" ? sql`asc nulls last` : sql`desc nulls last`}`, asc(d.name)];
  const [{ total }] = await db.select({ total: sql<number>`count(*)::int` }).from(d).leftJoin(ds, eq(ds.deviceId, d.id)).where(and(...where));
  const rows = await db
    .select({ id: d.id, name: d.name, platform: d.platform, deviceType: d.deviceType, status: d.status, siteId: d.siteId, siteName: schema.sites.name, lastSeenAt: d.lastSeenAt, osName: d.osName, osVersion: d.osVersion, loggedInUser: d.loggedInUser, score: ds.score, findings: ds.findings, posture: ds.posture, postureUpdatedAt: ds.updatedAt })
    .from(d)
    .leftJoin(ds, eq(ds.deviceId, d.id))
    .leftJoin(schema.sites, eq(schema.sites.id, d.siteId))
    .where(and(...where))
    .orderBy(...order)
    .limit(pr.pageSize)
    .offset((pr.page - 1) * pr.pageSize);
  const items = rows.map((r) => {
    const ev = r.posture ? evaluatePosture(r.posture, r.platform) : null;
    const { posture: _p, ...rest } = r;
    void _p;
    return { ...rest, findings: r.findings ?? [], band: scoreBand(r.score), checks: ev ? { passed: ev.passed, failed: ev.failed, unknown: ev.unknown } : null, flags: postureFlags(r.posture) };
  });
  return { items, total, page: pr.page, pageSize: pr.pageSize, pages: Math.max(1, Math.ceil(total / pr.pageSize)) };
}

export async function devicePosture(orgId: string, deviceId: string) {
  await refreshPostureScores(orgId);
  const db = await getDb();
  const [row] = await db.select({ id: d.id, name: d.name, platform: d.platform, status: d.status, osName: d.osName, posture: ds.posture, score: ds.score, findings: ds.findings, updatedAt: ds.updatedAt }).from(d).leftJoin(ds, eq(ds.deviceId, d.id)).where(and(eq(d.id, deviceId), eq(d.orgId, orgId)));
  if (!row) return null;
  const ev = evaluatePosture(row.posture, row.platform);
  return { ...row, findings: row.findings ?? [], band: scoreBand(row.score), evaluation: { ...ev, checks: ev.checks.map((c) => ({ ...c, remediation: CHECK_BY_ID.get(c.id)?.remediation })) }, flags: postureFlags(row.posture) };
}

export async function securitySummary(orgId: string, siteIds?: string[]) {
  await refreshPostureScores(orgId);
  const db = await getDb();
  const rows = await db.select({ id: d.id, platform: d.platform, status: d.status, posture: ds.posture, score: ds.score, findings: ds.findings, updatedAt: ds.updatedAt }).from(d).leftJoin(ds, eq(ds.deviceId, d.id)).where(and(...deviceScope(orgId, siteIds)));
  const distribution = { excellent: 0, good: 0, fair: 0, poor: 0, unknown: 0 };
  const coverageIds = ["antivirus", "firewall", "disk_encryption", "auto_update", "secure_boot", "screen_lock", "edr"] as const;
  const coverage: Record<string, { pass: number; fail: number; unknown: number; label: string }> = Object.fromEntries(coverageIds.map((id) => [id, { pass: 0, fail: 0, unknown: 0, label: CHECK_BY_ID.get(id)!.label }]));
  const failing: Record<string, number> = {};
  const findingsBySeverity: Record<FindingSeverity, number> = { critical: 0, high: 0, medium: 0, low: 0 };
  const adminCounts: Record<string, number> = {};
  let adminSprawl = 0, adminAccounts = 0, rdpExposed = 0, smbv1 = 0, sshRoot = 0, guest = 0, riskyPorts = 0, collected = 0, scoreSum = 0, scored = 0;
  const byPlatform: Record<string, { devices: number; collected: number; scoreSum: number; scored: number }> = {};
  let lastCollectedAt: Date | null = null;
  for (const r of rows) {
    const bp = (byPlatform[r.platform] ??= { devices: 0, collected: 0, scoreSum: 0, scored: 0 });
    bp.devices++;
    if (!r.posture) { distribution.unknown++; continue; }
    collected++; bp.collected++;
    if (r.updatedAt && (!lastCollectedAt || r.updatedAt > lastCollectedAt)) lastCollectedAt = r.updatedAt;
    const ev = evaluatePosture(r.posture, r.platform);
    distribution[scoreBand(ev.score)]++;
    if (ev.score !== null) { scoreSum += ev.score; scored++; bp.scoreSum += ev.score; bp.scored++; }
    for (const c of ev.checks) {
      if (c.id in coverage) coverage[c.id][c.status]++;
      if (c.status === "fail") { failing[c.id] = (failing[c.id] ?? 0) + 1; findingsBySeverity[c.severity]++; }
    }
    const p = r.posture;
    if (p.localAdmins) { adminAccounts += p.localAdmins.length; if (p.localAdmins.length > MAX_LOCAL_ADMINS) adminSprawl++; for (const a of p.localAdmins) adminCounts[a] = (adminCounts[a] ?? 0) + 1; }
    if (p.remoteDesktopEnabled) rdpExposed++;
    if (p.smbV1Enabled) smbv1++;
    if (p.sshRootLogin) sshRoot++;
    if (p.guestAccountEnabled) guest++;
    if (p.openPorts?.some((o) => RISKY_PORTS[o.port])) riskyPorts++;
  }
  const topFailing = Object.entries(failing).map(([id, count]) => ({ id, count, label: CHECK_BY_ID.get(id)?.label ?? id, severity: CHECK_BY_ID.get(id)?.severity ?? "medium", remediation: CHECK_BY_ID.get(id)?.remediation })).sort((a, b) => b.count - a.count).slice(0, 10);
  return {
    devices: rows.length,
    collected,
    notCollected: rows.length - collected,
    averageScore: scored ? Math.round(scoreSum / scored) : null,
    distribution,
    coverage,
    topFailing,
    findingsBySeverity,
    localAdmins: { devicesOverLimit: adminSprawl, accounts: adminAccounts, limit: MAX_LOCAL_ADMINS, topAccounts: Object.entries(adminCounts).map(([username, devices]) => ({ username, devices })).sort((a, b) => b.devices - a.devices).slice(0, 8) },
    exposure: { remoteDesktop: rdpExposed, smbv1, sshRootLogin: sshRoot, guestAccount: guest, riskyPorts },
    byPlatform: Object.fromEntries(Object.entries(byPlatform).map(([k, v]) => [k, { devices: v.devices, collected: v.collected, averageScore: v.scored ? Math.round(v.scoreSum / v.scored) : null }])),
    lastCollectedAt,
  };
}

export interface FindingsParams { orgId: string; q?: string; severity?: string[]; platform?: string[]; siteId?: string; siteIds?: string[]; check?: string; deviceId?: string; page: number; pageSize: number }

/** Flattened findings across the fleet (newest posture first within a severity). */
export async function listFindings(pr: FindingsParams) {
  await refreshPostureScores(pr.orgId);
  const db = await getDb();
  const where = deviceScope(pr.orgId, pr.siteIds, pr.siteId);
  where.push(sql`jsonb_array_length(coalesce(${ds.findings}, '[]'::jsonb)) > 0`);
  if (pr.platform?.length) where.push(inArray(d.platform, pr.platform as (typeof d.$inferSelect.platform)[]));
  if (pr.deviceId) where.push(eq(d.id, pr.deviceId));
  if (pr.check) where.push(sql`${ds.findings} @> ${JSON.stringify([{ id: pr.check }])}::jsonb`);
  const rows = await db.select({ deviceId: d.id, deviceName: d.name, platform: d.platform, deviceStatus: d.status, siteId: d.siteId, findings: ds.findings, updatedAt: ds.updatedAt, score: ds.score }).from(d).innerJoin(ds, eq(ds.deviceId, d.id)).where(and(...where));
  const rank: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };
  const q = pr.q?.toLowerCase();
  let flat = rows.flatMap((r) => r.findings.map((f) => ({ ...f, remediation: CHECK_BY_ID.get(f.id)?.remediation, category: CHECK_BY_ID.get(f.id)?.category ?? "hardening", deviceId: r.deviceId, deviceName: r.deviceName, platform: r.platform, deviceStatus: r.deviceStatus, siteId: r.siteId, score: r.score, updatedAt: r.updatedAt })));
  if (pr.severity?.length) flat = flat.filter((f) => pr.severity!.includes(f.severity));
  if (pr.check) flat = flat.filter((f) => f.id === pr.check);
  if (q) flat = flat.filter((f) => `${f.title} ${f.detail ?? ""} ${f.deviceName}`.toLowerCase().includes(q));
  flat.sort((a, b) => (rank[a.severity] ?? 9) - (rank[b.severity] ?? 9) || (b.updatedAt?.getTime() ?? 0) - (a.updatedAt?.getTime() ?? 0) || a.deviceName.localeCompare(b.deviceName));
  const bySeverity: Record<string, number> = {};
  for (const f of flat) bySeverity[f.severity] = (bySeverity[f.severity] ?? 0) + 1;
  const total = flat.length;
  const start = (pr.page - 1) * pr.pageSize;
  return { items: flat.slice(start, start + pr.pageSize), total, page: pr.page, pageSize: pr.pageSize, pages: Math.max(1, Math.ceil(total / pr.pageSize)), bySeverity, devices: rows.length };
}

/** Queue a posture collection (full inventory refresh is what carries the security section). */
export async function scanDevices(orgId: string, target: TargetSpec, who: { id: string | null; name: string | null }, siteIds?: string[], runWhenOnline = true) {
  const devices = await resolveScopedTargets(orgId, target, siteIds);
  if (!devices.length) return null;
  const { job, runs } = await createJob({ orgId, type: "inventory", name: `Security posture scan (${devices.length} device${devices.length === 1 ? "" : "s"})`, targetType: "device", targetIds: devices.map((x) => x.id), payload: { full: true, reason: "security_scan" }, source: "manual", runWhenOnline, timeoutSeconds: 600, concurrency: 50, createdBy: who.id, createdByName: who.name });
  bus.publish("security.scan.requested", { jobId: job.id, devices: runs.length, by: who.name }, { orgId });
  return { job, devices: runs.length, online: devices.filter((x) => x.status === "online").length };
}
