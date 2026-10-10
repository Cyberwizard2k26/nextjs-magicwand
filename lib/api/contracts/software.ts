/**
 * Software API contracts (fleet inventory, catalog, licenses, watchlist) shared by the routes and the OpenAPI area
 * file. No Next.js imports here: area files may be loaded outside a request.
 */
import { z } from "zod";

/** Same shape as `paginationQuery` in lib/api/route.ts (duplicated so this file stays dependency-free). */
export const pagination = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(500).default(50),
  q: z.string().max(200).optional(),
  sort: z.string().max(60).optional(),
  dir: z.enum(["asc", "desc"]).optional(),
});

/** Comma separated or repeated query values -> string[]. */
export const csvList = z.array(z.string()).or(z.string().transform((s) => s.split(",").map((x) => x.trim()).filter(Boolean)));
/** Query-string boolean ("1"/"true"/"yes" are true). */
export const flag = z.stringbool();

export const SOFTWARE_PLATFORMS = ["windows", "linux", "macos"] as const;
export type SoftwarePlatform = (typeof SOFTWARE_PLATFORMS)[number];
/** Package managers the agent can drive (see agent/internal/commands/software.go). */
export const PACKAGE_MANAGERS = ["winget", "choco", "msi", "exe", "msix", "brew", "brew_cask", "pkg", "dmg", "apt", "dnf", "snap", "flatpak", "script", "url"] as const;
export type PackageManager = (typeof PACKAGE_MANAGERS)[number];
export const SOFTWARE_SOURCES = ["msi", "exe", "store", "winget", "choco", "apt", "dnf", "rpm", "snap", "flatpak", "brew", "pkg", "app", "pip", "npm", "other"] as const;

export const Canary = z.object({ count: z.number().int().min(1).max(1000), autoPromote: z.boolean().default(true) }).describe("Run on `count` devices first; the rest is promoted automatically when the canary finishes clean.");

/** Device targeting shared by every fleet action in this area. */
export const TargetFields = {
  deviceIds: z.array(z.string()).max(5000).optional().describe("Explicit device ids."),
  groupId: z.string().optional().describe("Every device in this group (static or dynamic)."),
  siteId: z.string().optional().describe("Every device at this site."),
  all: z.boolean().optional().describe("Every device in the organization."),
};
export const hasTarget = (b: { deviceIds?: string[]; groupId?: string; siteId?: string; all?: boolean }) => !!(b.deviceIds?.length || b.groupId || b.siteId || b.all);

/* ------------------------------------------------------------------ inventory */

export const SoftwareInventoryQuery = pagination.extend({
  name: z.string().max(300).optional().describe("Exact software name: returns the per-device breakdown for this package instead of the aggregate list."),
  publisher: z.string().max(300).optional(),
  platform: csvList.optional().describe("windows | linux | macos (comma separated)."),
  source: csvList.optional().describe("Inventory source: winget, msi, apt, brew, ... (comma separated)."),
  siteId: z.string().optional(),
  system: flag.optional().describe("Include OS/system components (hidden by default)."),
  summary: flag.optional().describe("Also return fleet counters (packages, devices inventoried, watchlist hits)."),
  sort: z.enum(["devices", "name", "publisher", "versions", "firstSeenAt", "lastSeenAt"]).optional(),
});
export type SoftwareInventoryQuery = z.infer<typeof SoftwareInventoryQuery>;

export const SoftwareUninstallBody = z.object({
  name: z.string().min(1).max(300).describe("Software name exactly as it appears in the inventory."),
  deviceIds: z.array(z.string()).max(5000).optional().describe("Limit to these devices; default: every device where it is installed."),
  canary: Canary.optional(),
});
export type SoftwareUninstallBody = z.infer<typeof SoftwareUninstallBody>;

export const SoftwareInstallBody = z
  .object({
    ...TargetFields,
    manager: z.enum(PACKAGE_MANAGERS).optional().describe("Package manager. Default per platform: winget / apt (dnf on RHEL-like) / brew."),
    package: z.string().max(300).optional().describe("Package id for the manager (winget id, apt/brew package name)."),
    version: z.string().max(100).optional(),
    url: z.url().max(2000).optional().describe("Installer download URL for msi/exe/pkg/url managers (HTTPS)."),
    sha256: z.string().regex(/^[a-f0-9]{64}$/i).optional().describe("Expected SHA-256 of the download; install is refused on mismatch."),
    args: z.string().max(2000).optional().describe("Extra silent-install arguments."),
    name: z.string().max(300).optional().describe("Display name used for the job."),
    canary: Canary.optional(),
  })
  .refine((b) => !!(b.package || b.url), { message: "package or url is required", path: ["package"] })
  .refine(hasTarget, { message: "deviceIds, groupId, siteId or all is required", path: ["deviceIds"] });
export type SoftwareInstallBody = z.infer<typeof SoftwareInstallBody>;

/* ------------------------------------------------------------------ catalog */

export const DetectionRule = z.object({
  type: z.enum(["software_name", "file", "registry", "command"]),
  value: z.string().min(1).max(500).describe("For software_name: inventory name pattern, `*` is a wildcard."),
  version: z.string().max(100).optional(),
});

export const CatalogQuery = pagination.extend({
  platform: csvList.optional(),
  packageManager: csvList.optional(),
  category: z.string().max(80).optional(),
  builtin: flag.optional().describe("Only built-in (true) or only organization entries (false)."),
  selfService: flag.optional(),
  tag: z.string().max(40).optional(),
  sort: z.enum(["name", "publisher", "category", "installedDevices", "updatedAt"]).optional(),
});
export type CatalogQuery = z.infer<typeof CatalogQuery>;

const catalogBase = z.object({
  name: z.string().trim().min(1).max(200),
  publisher: z.string().trim().max(200).nullable().optional(),
  description: z.string().max(2000).nullable().optional(),
  iconUrl: z.url().max(2000).nullable().optional(),
  category: z.string().trim().max(80).nullable().optional(),
  platform: z.enum(SOFTWARE_PLATFORMS),
  packageManager: z.enum(PACKAGE_MANAGERS),
  packageId: z.string().trim().max(300).nullable().optional().describe("Identifier for the manager, e.g. winget `Google.Chrome`, brew `google-chrome`, apt `git`."),
  version: z.string().trim().max(100).nullable().optional().describe("Pin a version; empty installs the latest."),
  downloadUrl: z.url().max(2000).nullable().optional(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/i).nullable().optional(),
  installArgs: z.string().max(2000).nullable().optional(),
  uninstallArgs: z.string().max(2000).nullable().optional(),
  installScript: z.string().max(20000).nullable().optional(),
  uninstallScript: z.string().max(20000).nullable().optional(),
  detection: z.array(DetectionRule).max(10).default([]),
  selfService: z.boolean().default(false).describe("Offer in the end-user self-service portal."),
  requiresReboot: z.boolean().default(false),
  licenseType: z.string().max(80).nullable().optional(),
  tags: z.array(z.string().trim().min(1).max(40)).max(20).default([]),
});
export const CatalogEntryBody = catalogBase.refine((b) => !!(b.packageId || b.downloadUrl || b.installScript), { message: "packageId, downloadUrl or installScript is required", path: ["packageId"] });
export type CatalogEntryBody = z.infer<typeof CatalogEntryBody>;
export const CatalogEntryPatch = catalogBase.partial();
export type CatalogEntryPatch = z.infer<typeof CatalogEntryPatch>;

export const CatalogDeployBody = z
  .object({
    ...TargetFields,
    version: z.string().max(100).optional().describe("Override the catalog version for this deployment."),
    canary: Canary.optional(),
    runWhenOnline: z.boolean().default(true),
  })
  .refine(hasTarget, { message: "deviceIds, groupId, siteId or all is required", path: ["deviceIds"] });
export type CatalogDeployBody = z.infer<typeof CatalogDeployBody>;

/* ------------------------------------------------------------------ licenses */

const isoDate = z.string().max(40).refine((s) => !Number.isNaN(Date.parse(s)), "Invalid date");

export const LicenseQuery = pagination.extend({
  state: z.enum(["ok", "over", "expiring", "expired", "unmatched"]).optional().describe("Filter by computed state."),
  vendor: z.string().max(200).optional(),
  sort: z.enum(["name", "vendor", "seats", "installed", "utilization", "expiresAt", "cost"]).optional(),
});
export type LicenseQuery = z.infer<typeof LicenseQuery>;

export const LicenseBody = z.object({
  name: z.string().trim().min(1).max(200),
  vendor: z.string().trim().max(200).nullable().optional(),
  matchName: z.string().trim().max(200).nullable().optional().describe("Inventory name pattern counted against seats (`*` wildcard, case-insensitive)."),
  seats: z.number().int().min(0).max(10_000_000).nullable().optional().describe("Purchased seats; null = unlimited / site license."),
  key: z.string().max(8000).optional().describe("License key; stored encrypted, never listed, revealed through an audited endpoint."),
  purchaseDate: isoDate.nullable().optional(),
  expiresAt: isoDate.nullable().optional(),
  cost: z.number().min(0).max(1e9).nullable().optional(),
  currency: z.string().trim().length(3).toUpperCase().optional(),
  notes: z.string().max(5000).nullable().optional(),
});
export type LicenseBody = z.infer<typeof LicenseBody>;
export const LicensePatch = LicenseBody.partial().extend({ clearKey: z.boolean().optional().describe("Remove the stored key.") });
export type LicensePatch = z.infer<typeof LicensePatch>;

/* ------------------------------------------------------------------ watchlist */

export const WatchlistEntry = z.object({
  pattern: z.string().trim().min(1).max(200).describe("Software name pattern, case-insensitive; `*` matches anything (e.g. `*torrent*`)."),
  note: z.string().max(500).optional(),
  severity: z.enum(["low", "medium", "high", "critical"]).default("medium"),
});
export type WatchlistEntry = z.infer<typeof WatchlistEntry>;
export const WatchlistBody = z.object({ entries: z.array(WatchlistEntry).max(200) });
export type WatchlistBody = z.infer<typeof WatchlistBody>;
