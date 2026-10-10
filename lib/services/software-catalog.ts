/**
 * Software catalog: built-in entries shipped with the product (orgId null, isBuiltin) plus per-organization
 * entries, each bound to one platform + package manager. Variants of the same application share a name, so a
 * deployment to a mixed fleet picks the right variant per device. Detection rules count installs from the inventory.
 */
import { and, asc, desc, eq, inArray, isNull, or, sql, type SQL } from "drizzle-orm";
import { getDb, schema } from "../db";
import { bus } from "../bus";
import type { Principal } from "../auth/session";
import { createJobFromRequest } from "./job-create";
import { likePattern, platformOf, resolveScopedTargets, type TargetSpec } from "./software-inventory";
import type { CatalogEntryBody, CatalogEntryPatch, CatalogDeployBody, PackageManager, SoftwarePlatform } from "../api/contracts/software";

const cat = schema.softwareCatalog;
const sw = schema.deviceSoftware;
const d = schema.devices;

export type CatalogEntry = typeof cat.$inferSelect;

/* ------------------------------------------------------------------ built-in catalog */

interface BuiltinVariant { platform: SoftwarePlatform; manager: PackageManager; packageId?: string; url?: string; args?: string; detect?: string; requiresReboot?: boolean; note?: string }
interface BuiltinApp { name: string; publisher: string; category: string; description: string; tags?: string[]; selfService?: boolean; licenseType?: string; variants: BuiltinVariant[] }

export const BUILTIN_CATALOG: BuiltinApp[] = [
  { name: "Google Chrome", publisher: "Google", category: "Browsers", description: "Chrome browser, enterprise MSI-equivalent silent install.", tags: ["browser"], selfService: true, licenseType: "freeware", variants: [{ platform: "windows", manager: "winget", packageId: "Google.Chrome", detect: "Google Chrome*" }, { platform: "macos", manager: "brew_cask", packageId: "google-chrome", detect: "Google Chrome*" }, { platform: "linux", manager: "flatpak", packageId: "com.google.Chrome", detect: "*google-chrome*" }] },
  { name: "Mozilla Firefox", publisher: "Mozilla", category: "Browsers", description: "Firefox browser.", tags: ["browser"], selfService: true, licenseType: "open source", variants: [{ platform: "windows", manager: "winget", packageId: "Mozilla.Firefox", detect: "Mozilla Firefox*" }, { platform: "macos", manager: "brew_cask", packageId: "firefox", detect: "Firefox*" }, { platform: "linux", manager: "apt", packageId: "firefox", detect: "firefox*" }] },
  { name: "Microsoft Edge", publisher: "Microsoft", category: "Browsers", description: "Edge browser (Chromium).", tags: ["browser"], selfService: true, licenseType: "freeware", variants: [{ platform: "windows", manager: "winget", packageId: "Microsoft.Edge", detect: "Microsoft Edge*" }, { platform: "macos", manager: "brew_cask", packageId: "microsoft-edge", detect: "Microsoft Edge*" }] },
  { name: "7-Zip", publisher: "Igor Pavlov", category: "Utilities", description: "File archiver with high compression ratio.", tags: ["archive"], selfService: true, licenseType: "open source", variants: [{ platform: "windows", manager: "winget", packageId: "7zip.7zip", detect: "7-Zip*" }, { platform: "linux", manager: "apt", packageId: "p7zip-full", detect: "p7zip*" }, { platform: "macos", manager: "brew", packageId: "sevenzip", detect: "sevenzip*" }] },
  { name: "VLC media player", publisher: "VideoLAN", category: "Media", description: "Plays every media format.", tags: ["media"], selfService: true, licenseType: "open source", variants: [{ platform: "windows", manager: "winget", packageId: "VideoLAN.VLC", detect: "VLC media player*" }, { platform: "macos", manager: "brew_cask", packageId: "vlc", detect: "VLC*" }, { platform: "linux", manager: "apt", packageId: "vlc", detect: "vlc" }] },
  { name: "Notepad++", publisher: "Notepad++ Team", category: "Developer tools", description: "Text and source code editor for Windows.", tags: ["editor"], selfService: true, licenseType: "open source", variants: [{ platform: "windows", manager: "winget", packageId: "Notepad++.Notepad++", detect: "Notepad++*" }] },
  { name: "Adobe Acrobat Reader", publisher: "Adobe", category: "Productivity", description: "PDF reader (64-bit).", tags: ["pdf"], selfService: true, licenseType: "freeware", variants: [{ platform: "windows", manager: "winget", packageId: "Adobe.Acrobat.Reader.64-bit", detect: "Adobe Acrobat*" }, { platform: "macos", manager: "brew_cask", packageId: "adobe-acrobat-reader", detect: "Adobe Acrobat*" }] },
  { name: "Zoom", publisher: "Zoom Video Communications", category: "Collaboration", description: "Zoom meetings client.", tags: ["meetings"], selfService: true, licenseType: "freeware", variants: [{ platform: "windows", manager: "winget", packageId: "Zoom.Zoom", detect: "Zoom*" }, { platform: "macos", manager: "brew_cask", packageId: "zoom", detect: "zoom.us*" }, { platform: "linux", manager: "flatpak", packageId: "us.zoom.Zoom", detect: "*zoom*" }] },
  { name: "Microsoft Teams", publisher: "Microsoft", category: "Collaboration", description: "Teams (new client).", tags: ["meetings", "chat"], selfService: true, licenseType: "subscription", variants: [{ platform: "windows", manager: "winget", packageId: "Microsoft.Teams", detect: "Microsoft Teams*" }, { platform: "macos", manager: "brew_cask", packageId: "microsoft-teams", detect: "Microsoft Teams*" }] },
  { name: "Slack", publisher: "Slack Technologies", category: "Collaboration", description: "Slack desktop client.", tags: ["chat"], selfService: true, licenseType: "subscription", variants: [{ platform: "windows", manager: "winget", packageId: "SlackTechnologies.Slack", detect: "Slack*" }, { platform: "macos", manager: "brew_cask", packageId: "slack", detect: "Slack*" }, { platform: "linux", manager: "snap", packageId: "slack", detect: "slack" }] },
  { name: "Visual Studio Code", publisher: "Microsoft", category: "Developer tools", description: "Source code editor (system-wide install).", tags: ["editor", "dev"], selfService: true, licenseType: "freeware", variants: [{ platform: "windows", manager: "winget", packageId: "Microsoft.VisualStudioCode", detect: "Microsoft Visual Studio Code*" }, { platform: "macos", manager: "brew_cask", packageId: "visual-studio-code", detect: "Visual Studio Code*" }, { platform: "linux", manager: "flatpak", packageId: "com.visualstudio.code", detect: "*visualstudio.code*" }] },
  { name: "Git", publisher: "Software Freedom Conservancy", category: "Developer tools", description: "Distributed version control.", tags: ["dev"], licenseType: "open source", variants: [{ platform: "windows", manager: "winget", packageId: "Git.Git", detect: "Git*" }, { platform: "macos", manager: "brew", packageId: "git", detect: "git" }, { platform: "linux", manager: "apt", packageId: "git", detect: "git" }, { platform: "linux", manager: "dnf", packageId: "git", detect: "git", note: "RHEL-like distributions" }] },
  { name: "Python 3", publisher: "Python Software Foundation", category: "Developer tools", description: "Python 3.12 runtime.", tags: ["runtime", "dev"], licenseType: "open source", variants: [{ platform: "windows", manager: "winget", packageId: "Python.Python.3.12", detect: "Python 3*" }, { platform: "macos", manager: "brew", packageId: "python@3.12", detect: "python@3*" }, { platform: "linux", manager: "apt", packageId: "python3", detect: "python3" }, { platform: "linux", manager: "dnf", packageId: "python3", detect: "python3" }] },
  { name: "Node.js LTS", publisher: "OpenJS Foundation", category: "Developer tools", description: "Node.js long-term-support runtime.", tags: ["runtime", "dev"], licenseType: "open source", variants: [{ platform: "windows", manager: "winget", packageId: "OpenJS.NodeJS.LTS", detect: "Node.js*" }, { platform: "macos", manager: "brew", packageId: "node", detect: "node" }, { platform: "linux", manager: "apt", packageId: "nodejs", detect: "nodejs" }, { platform: "linux", manager: "dnf", packageId: "nodejs", detect: "nodejs" }] },
  { name: "Java (Temurin 21 JDK)", publisher: "Eclipse Adoptium", category: "Runtimes", description: "OpenJDK 21 LTS build by Eclipse Adoptium.", tags: ["runtime"], licenseType: "open source", variants: [{ platform: "windows", manager: "winget", packageId: "EclipseAdoptium.Temurin.21.JDK", detect: "Eclipse Temurin JDK*21*" }, { platform: "macos", manager: "brew_cask", packageId: "temurin@21", detect: "temurin*21*" }, { platform: "linux", manager: "apt", packageId: "openjdk-21-jdk", detect: "openjdk-21*" }, { platform: "linux", manager: "dnf", packageId: "java-21-openjdk", detect: "java-21-openjdk*" }] },
  { name: "PowerShell 7", publisher: "Microsoft", category: "Admin tools", description: "Cross-platform PowerShell.", tags: ["shell", "admin"], licenseType: "open source", variants: [{ platform: "windows", manager: "winget", packageId: "Microsoft.PowerShell", detect: "PowerShell 7*" }, { platform: "macos", manager: "brew_cask", packageId: "powershell", detect: "PowerShell*" }] },
  { name: "Windows Terminal", publisher: "Microsoft", category: "Admin tools", description: "Modern terminal host for Windows.", tags: ["shell"], selfService: true, licenseType: "open source", variants: [{ platform: "windows", manager: "winget", packageId: "Microsoft.WindowsTerminal", detect: "Windows Terminal*" }] },
  { name: "TeamViewer QuickSupport", publisher: "TeamViewer", category: "Remote support", description: "Attended support client; runs immediately after download so the user can read the session id to the technician.", tags: ["remote"], licenseType: "subscription", variants: [{ platform: "windows", manager: "exe", url: "https://download.teamviewer.com/download/TeamViewerQS_x64.exe", args: "", detect: "TeamViewer*" }, { platform: "macos", manager: "brew_cask", packageId: "teamviewer", detect: "TeamViewer*" }] },
  { name: "Sysinternals Suite", publisher: "Microsoft", category: "Admin tools", description: "Process Explorer, Autoruns, Procmon, PsTools and friends.", tags: ["admin", "diagnostics"], licenseType: "freeware", variants: [{ platform: "windows", manager: "winget", packageId: "9P7KNL5RWT25", detect: "Sysinternals*", note: "Microsoft Store package id" }] },
  { name: "Wireshark", publisher: "Wireshark Foundation", category: "Network tools", description: "Network protocol analyser.", tags: ["network", "diagnostics"], licenseType: "open source", variants: [{ platform: "windows", manager: "winget", packageId: "WiresharkFoundation.Wireshark", detect: "Wireshark*" }, { platform: "macos", manager: "brew_cask", packageId: "wireshark", detect: "Wireshark*" }, { platform: "linux", manager: "apt", packageId: "wireshark", detect: "wireshark*" }] },
  { name: "PuTTY", publisher: "Simon Tatham", category: "Network tools", description: "SSH and telnet client.", tags: ["ssh"], selfService: true, licenseType: "open source", variants: [{ platform: "windows", manager: "winget", packageId: "PuTTY.PuTTY", detect: "PuTTY*" }, { platform: "linux", manager: "apt", packageId: "putty", detect: "putty*" }, { platform: "macos", manager: "brew", packageId: "putty", detect: "putty" }] },
  { name: "WinSCP", publisher: "Martin Prikryl", category: "Network tools", description: "SFTP, FTP and SCP client for Windows.", tags: ["sftp"], selfService: true, licenseType: "open source", variants: [{ platform: "windows", manager: "winget", packageId: "WinSCP.WinSCP", detect: "WinSCP*" }] },
  { name: "curl", publisher: "curl project", category: "Admin tools", description: "Command-line HTTP client.", tags: ["cli"], licenseType: "open source", variants: [{ platform: "windows", manager: "winget", packageId: "cURL.cURL", detect: "cURL*" }, { platform: "linux", manager: "apt", packageId: "curl", detect: "curl" }, { platform: "linux", manager: "dnf", packageId: "curl", detect: "curl" }, { platform: "macos", manager: "brew", packageId: "curl", detect: "curl" }] },
  { name: "htop", publisher: "htop dev team", category: "Admin tools", description: "Interactive process viewer.", tags: ["cli", "diagnostics"], licenseType: "open source", variants: [{ platform: "linux", manager: "apt", packageId: "htop", detect: "htop" }, { platform: "linux", manager: "dnf", packageId: "htop", detect: "htop" }, { platform: "macos", manager: "brew", packageId: "htop", detect: "htop" }] },
  { name: "nmap", publisher: "Nmap Project", category: "Network tools", description: "Network discovery and port scanner.", tags: ["network", "security"], licenseType: "open source", variants: [{ platform: "windows", manager: "winget", packageId: "Insecure.Nmap", detect: "Nmap*" }, { platform: "linux", manager: "apt", packageId: "nmap", detect: "nmap" }, { platform: "macos", manager: "brew", packageId: "nmap", detect: "nmap" }] },
  { name: "Docker", publisher: "Docker Inc.", category: "Developer tools", description: "Docker Desktop (Windows/macOS) or the Docker engine (Linux).", tags: ["containers", "dev"], licenseType: "subscription", variants: [{ platform: "windows", manager: "winget", packageId: "Docker.DockerDesktop", detect: "Docker Desktop*", requiresReboot: true }, { platform: "macos", manager: "brew_cask", packageId: "docker", detect: "Docker*" }, { platform: "linux", manager: "apt", packageId: "docker.io", detect: "docker*" }, { platform: "linux", manager: "dnf", packageId: "moby-engine", detect: "moby-engine*" }] },
  { name: "LibreOffice", publisher: "The Document Foundation", category: "Productivity", description: "Office suite.", tags: ["office"], selfService: true, licenseType: "open source", variants: [{ platform: "windows", manager: "winget", packageId: "TheDocumentFoundation.LibreOffice", detect: "LibreOffice*" }, { platform: "macos", manager: "brew_cask", packageId: "libreoffice", detect: "LibreOffice*" }, { platform: "linux", manager: "apt", packageId: "libreoffice", detect: "libreoffice*" }] },
];

interface CatalogGlobal { __mwCatalogSeeded?: boolean }
const g = globalThis as unknown as CatalogGlobal;

/** Insert the built-in catalog once (idempotent on name+platform+manager). */
export async function ensureBuiltinCatalog() {
  if (g.__mwCatalogSeeded) return;
  const db = await getDb();
  const existing = await db.select({ name: cat.name, platform: cat.platform, packageManager: cat.packageManager }).from(cat).where(eq(cat.isBuiltin, true));
  const have = new Set(existing.map((e) => `${e.name}|${e.platform}|${e.packageManager}`));
  const rows: (typeof cat.$inferInsert)[] = [];
  for (const app of BUILTIN_CATALOG) {
    for (const v of app.variants) {
      if (have.has(`${app.name}|${v.platform}|${v.manager}`)) continue;
      rows.push({
        orgId: null, name: app.name, publisher: app.publisher, description: v.note ? `${app.description} ${v.note}.` : app.description, category: app.category, platform: v.platform, packageManager: v.manager, packageId: v.packageId ?? null, downloadUrl: v.url ?? null, installArgs: v.args ?? null,
        detection: [{ type: "software_name", value: v.detect ?? v.packageId ?? app.name }], selfService: app.selfService ?? false, requiresReboot: v.requiresReboot ?? false, licenseType: app.licenseType ?? null, tags: app.tags ?? [], isBuiltin: true,
      });
    }
  }
  if (rows.length) await db.insert(cat).values(rows);
  g.__mwCatalogSeeded = true;
}

/* ------------------------------------------------------------------ queries */

function visible(orgId: string): SQL {
  return or(eq(cat.orgId, orgId), and(isNull(cat.orgId), eq(cat.isBuiltin, true)))!;
}

/** Devices (per platform) whose inventory matches each software_name detection pattern. */
async function installedCounts(orgId: string, entries: Pick<CatalogEntry, "id" | "platform" | "detection" | "name">[], siteIds?: string[]): Promise<Record<string, number>> {
  const pairs: { id: string; pattern: string; platform: string }[] = [];
  for (const e of entries) {
    const rules = e.detection.filter((r) => r.type === "software_name");
    for (const r of rules.length ? rules : [{ type: "software_name", value: e.name }]) pairs.push({ id: e.id, pattern: likePattern(r.value, false), platform: e.platform });
  }
  if (!pairs.length) return {};
  const db = await getDb();
  const values = sql.join(pairs.map((p) => sql`(${p.id}::text, ${p.pattern}::text, ${p.platform}::text)`), sql`, `);
  const scope: SQL[] = [eq(sw.orgId, orgId), isNull(sw.removedAt), sql`${d.status} <> 'decommissioned'`];
  if (siteIds?.length) scope.push(inArray(d.siteId, siteIds));
  const rows = await db
    .select({ id: sql<string>`p.id`, n: sql<number>`count(distinct ${sw.deviceId})::int` })
    .from(sql`(values ${values}) as p(id, pattern, platform)`)
    .innerJoin(sw, sql`${sw.name} ilike p.pattern`)
    .innerJoin(d, and(eq(d.id, sw.deviceId), sql`${d.platform} = p.platform`))
    .where(and(...scope))
    .groupBy(sql`p.id`);
  const out: Record<string, number> = {};
  for (const r of rows) out[r.id] = (out[r.id] ?? 0) + r.n;
  return out;
}

export interface CatalogListParams { orgId: string; q?: string; platform?: string[]; packageManager?: string[]; category?: string; builtin?: boolean; selfService?: boolean; tag?: string; sort?: string; dir?: "asc" | "desc"; page: number; pageSize: number; siteIds?: string[] }

export async function listCatalog(p: CatalogListParams) {
  await ensureBuiltinCatalog();
  const db = await getDb();
  const where: SQL[] = [visible(p.orgId)];
  if (p.platform?.length) where.push(inArray(cat.platform, p.platform as CatalogEntry["platform"][]));
  if (p.packageManager?.length) where.push(inArray(cat.packageManager, p.packageManager as CatalogEntry["packageManager"][]));
  if (p.category) where.push(eq(cat.category, p.category));
  if (p.builtin !== undefined) where.push(eq(cat.isBuiltin, p.builtin));
  if (p.selfService !== undefined) where.push(eq(cat.selfService, p.selfService));
  if (p.tag) where.push(sql`${cat.tags} @> ${JSON.stringify([p.tag])}::jsonb`);
  if (p.q) {
    const like = likePattern(p.q);
    where.push(or(sql`${cat.name} ilike ${like}`, sql`${cat.publisher} ilike ${like}`, sql`${cat.packageId} ilike ${like}`, sql`${cat.description} ilike ${like}`)!);
  }
  const rows = await db.select().from(cat).where(and(...where)).orderBy(asc(cat.name), asc(cat.platform), asc(cat.packageManager));
  const counts = await installedCounts(p.orgId, rows, p.siteIds);
  let items = rows.map((r) => ({ ...r, installedDevices: counts[r.id] ?? 0 }));
  const dir = p.dir === "desc" ? -1 : 1;
  if (p.sort && p.sort !== "name") {
    const key = p.sort as "publisher" | "category" | "installedDevices" | "updatedAt";
    items = items.sort((a, b) => { const av = a[key] ?? "", bv = b[key] ?? ""; return (av < bv ? -1 : av > bv ? 1 : 0) * dir || a.name.localeCompare(b.name); });
  } else if (p.dir === "desc") items = items.reverse();
  const total = items.length;
  const start = (p.page - 1) * p.pageSize;
  const categories = [...new Set(rows.map((r) => r.category).filter(Boolean))].sort() as string[];
  return { items: items.slice(start, start + p.pageSize), total, page: p.page, pageSize: p.pageSize, pages: Math.max(1, Math.ceil(total / p.pageSize)), categories };
}

export async function getCatalogEntry(orgId: string, id: string, siteIds?: string[]) {
  await ensureBuiltinCatalog();
  const db = await getDb();
  const [row] = await db.select().from(cat).where(and(eq(cat.id, id), visible(orgId)));
  if (!row) return null;
  const variants = await db.select().from(cat).where(and(eq(cat.name, row.name), visible(orgId)));
  const counts = await installedCounts(orgId, variants, siteIds);
  return { ...row, installedDevices: counts[row.id] ?? 0, variants: variants.map((v) => ({ id: v.id, platform: v.platform, packageManager: v.packageManager, packageId: v.packageId, version: v.version, isBuiltin: v.isBuiltin, installedDevices: counts[v.id] ?? 0 })) };
}

export async function createCatalogEntry(orgId: string, body: CatalogEntryBody, userId: string | null) {
  const db = await getDb();
  const [row] = await db.insert(cat).values({ ...body, orgId, isBuiltin: false, createdBy: userId }).returning();
  bus.publish("software.catalog.updated", { id: row.id, name: row.name, action: "created" }, { orgId });
  return row;
}

export async function updateCatalogEntry(orgId: string, id: string, body: CatalogEntryPatch) {
  const db = await getDb();
  const [existing] = await db.select().from(cat).where(and(eq(cat.id, id), eq(cat.orgId, orgId)));
  if (!existing) return null;
  const [row] = await db.update(cat).set({ ...body }).where(eq(cat.id, id)).returning();
  bus.publish("software.catalog.updated", { id: row.id, name: row.name, action: "updated" }, { orgId });
  return row;
}

export async function deleteCatalogEntry(orgId: string, id: string) {
  const db = await getDb();
  const [row] = await db.delete(cat).where(and(eq(cat.id, id), eq(cat.orgId, orgId))).returning();
  if (row) bus.publish("software.catalog.updated", { id: row.id, name: row.name, action: "deleted" }, { orgId });
  return row ?? null;
}

/** Copy a (built-in) entry into the organization so it can be edited (pin a version, add install args...). */
export async function cloneCatalogEntry(orgId: string, id: string, userId: string | null) {
  const db = await getDb();
  const [src] = await db.select().from(cat).where(and(eq(cat.id, id), visible(orgId)));
  if (!src) return null;
  const { id: _id, createdAt: _c, updatedAt: _u, ...rest } = src;
  void _id; void _c; void _u;
  const [row] = await db.insert(cat).values({ ...rest, orgId, isBuiltin: false, createdBy: userId, tags: [...rest.tags.filter((t) => t !== "copy"), "copy"] }).returning();
  bus.publish("software.catalog.updated", { id: row.id, name: row.name, action: "cloned", from: id }, { orgId });
  return row;
}

/* ------------------------------------------------------------------ deployment */

export interface DeployResult {
  jobs: { jobId: string; name: string; platform: string; packageManager: string; devices: number; rolloutJobId: string | null }[];
  skipped: { deviceId: string; deviceName: string; reason: string }[];
  targeted: number;
}

/**
 * Deploy a catalog entry: devices are grouped by platform, each group gets the matching variant (same name) and one
 * software_install job (canary-aware). Permission checks happen in createJobFromRequest.
 */
export async function deployCatalogEntry(principal: Principal, orgId: string, id: string, body: CatalogDeployBody, siteIds?: string[]): Promise<DeployResult | null> {
  const entry = await getCatalogEntry(orgId, id, siteIds);
  if (!entry) return null;
  const db = await getDb();
  const variants = await db.select().from(cat).where(and(eq(cat.name, entry.name), visible(orgId)));
  // Prefer the chosen entry, then org-owned variants, then built-ins for the other platforms.
  const byPlatform = new Map<string, CatalogEntry>();
  for (const v of [...variants].sort((a, b) => (a.id === entry.id ? -1 : b.id === entry.id ? 1 : Number(a.isBuiltin) - Number(b.isBuiltin)))) if (!byPlatform.has(v.platform)) byPlatform.set(v.platform, v);
  const devices = await resolveScopedTargets(orgId, body as TargetSpec, siteIds);
  const groups = new Map<string, { variant: CatalogEntry; deviceIds: string[] }>();
  const skipped: DeployResult["skipped"] = [];
  for (const dev of devices) {
    const platform = platformOf(dev);
    const variant = platform ? byPlatform.get(platform) : undefined;
    if (!variant) { skipped.push({ deviceId: dev.id, deviceName: dev.name, reason: `no ${dev.platform} package for ${entry.name}` }); continue; }
    const grp = groups.get(variant.id) ?? { variant, deviceIds: [] };
    grp.deviceIds.push(dev.id);
    groups.set(variant.id, grp);
  }
  const jobs: DeployResult["jobs"] = [];
  for (const { variant, deviceIds } of groups.values()) {
    const payload = { manager: variant.packageManager, package: variant.packageId ?? undefined, version: body.version ?? variant.version ?? undefined, url: variant.downloadUrl ?? undefined, sha256: variant.sha256 ?? undefined, args: variant.installArgs ?? undefined, name: variant.name, catalogId: variant.id, requiresReboot: variant.requiresReboot };
    const r = await createJobFromRequest(principal, orgId, { type: "software_install", name: `Install ${variant.name} (${variant.platform} · ${variant.packageManager})`, targetType: "device", targetIds: deviceIds, payload, canary: body.canary, runWhenOnline: body.runWhenOnline, timeoutSeconds: 1800 });
    jobs.push({ jobId: r.job.id, name: r.job.name, platform: variant.platform, packageManager: variant.packageManager, devices: r.runs.length, rolloutJobId: r.rollout?.id ?? null });
  }
  bus.publish("software.catalog.deployed", { catalogId: entry.id, name: entry.name, jobs: jobs.map((j) => j.jobId), devices: devices.length - skipped.length }, { orgId });
  return { jobs, skipped, targeted: devices.length };
}
