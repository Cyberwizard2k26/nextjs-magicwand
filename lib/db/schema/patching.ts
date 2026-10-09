import { pgTable, text, boolean, integer, bigint, real, jsonb, index, uniqueIndex } from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { id, createdAt, updatedAt, ts, tsNullable } from "./_common";
import { organizations } from "./tenancy";
import { devices } from "./devices";

/* ---------------------------------------------------------------------------------------------
 * Patch management (OS + third-party), approvals, vulnerabilities, software catalog & licenses
 * ------------------------------------------------------------------------------------------- */

export type PatchSource = "windows_update" | "wsus" | "apt" | "dnf" | "yum" | "zypper" | "pacman" | "brew" | "winget" | "choco" | "macos_softwareupdate" | "snap" | "flatpak" | "pip" | "driver" | "firmware" | "other";
export type PatchCategory = "security" | "critical" | "important" | "moderate" | "low" | "feature" | "driver" | "definition" | "firmware" | "application" | "other";
export type PatchStatus = "available" | "approved" | "rejected" | "deferred" | "scheduled" | "downloading" | "installing" | "installed" | "failed" | "pending_reboot" | "superseded" | "not_applicable";

export const patches = pgTable(
  "patches",
  {
    id: id(),
    orgId: text("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    deviceId: text("device_id").notNull().references(() => devices.id, { onDelete: "cascade" }),
    /** Source-native identifier (KB number / update id / package name). */
    externalId: text("external_id").notNull(),
    title: text("title").notNull(),
    description: text("description"),
    source: text("source").$type<PatchSource>().notNull(),
    category: text("category").$type<PatchCategory>().notNull().default("other"),
    severity: text("severity").$type<"critical" | "important" | "moderate" | "low" | "unknown">().notNull().default("unknown"),
    kb: text("kb"),
    version: text("version"),
    currentVersion: text("current_version"),
    sizeBytes: bigint("size_bytes", { mode: "number" }),
    status: text("status").$type<PatchStatus>().notNull().default("available"),
    rebootRequired: boolean("reboot_required").notNull().default(false),
    cveIds: jsonb("cve_ids").$type<string[]>().notNull().default([]),
    releaseDate: tsNullable("release_date"),
    firstSeenAt: ts("first_seen_at"),
    lastSeenAt: ts("last_seen_at"),
    installedAt: tsNullable("installed_at"),
    installAttempts: integer("install_attempts").notNull().default(0),
    lastError: text("last_error"),
    lastJobId: text("last_job_id"),
    supportUrl: text("support_url"),
    data: jsonb("data").$type<Record<string, unknown>>().notNull().default({}),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("patches_device_external_idx").on(t.deviceId, t.externalId), index("patches_org_status_idx").on(t.orgId, t.status), index("patches_org_external_idx").on(t.orgId, t.externalId)],
);

export const patchApprovals = pgTable(
  "patch_approvals",
  {
    id: id(),
    orgId: text("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    targetType: text("target_type").$type<"org" | "site" | "group" | "device">().notNull().default("org"),
    targetId: text("target_id"),
    /** Match by exact external id, or by rule (categories/severities/sources/title regex). */
    externalId: text("external_id"),
    rule: jsonb("rule").$type<{ sources?: PatchSource[]; categories?: PatchCategory[]; severities?: string[]; titleRegex?: string; minAgeDays?: number } | null>(),
    decision: text("decision").$type<"approve" | "reject" | "defer" | "test">().notNull(),
    deferUntil: tsNullable("defer_until"),
    note: text("note"),
    createdBy: text("created_by"),
    createdAt: createdAt(),
  },
  (t) => [index("patch_approvals_org_idx").on(t.orgId)],
);

export const vulnerabilities = pgTable(
  "vulnerabilities",
  {
    id: id(),
    orgId: text("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    deviceId: text("device_id").notNull().references(() => devices.id, { onDelete: "cascade" }),
    cveId: text("cve_id").notNull(),
    title: text("title"),
    severity: text("severity").$type<"critical" | "high" | "medium" | "low" | "unknown">().notNull().default("unknown"),
    cvss: real("cvss"),
    epss: real("epss"),
    knownExploited: boolean("known_exploited").notNull().default(false),
    packageName: text("package_name"),
    installedVersion: text("installed_version"),
    fixedVersion: text("fixed_version"),
    source: text("source").$type<"osv" | "nvd" | "msrc" | "vendor" | "agent">().notNull().default("osv"),
    status: text("status").$type<"open" | "mitigated" | "resolved" | "accepted" | "false_positive">().notNull().default("open"),
    detectedAt: ts("detected_at"),
    resolvedAt: tsNullable("resolved_at"),
    references: jsonb("references").$type<string[]>().notNull().default([]),
    data: jsonb("data").$type<Record<string, unknown>>().notNull().default({}),
  },
  (t) => [uniqueIndex("vulnerabilities_device_cve_pkg_idx").on(t.deviceId, t.cveId, t.packageName), index("vulnerabilities_org_status_idx").on(t.orgId, t.status)],
);

export type PackageManager = "winget" | "choco" | "msi" | "exe" | "msix" | "brew" | "brew_cask" | "pkg" | "dmg" | "apt" | "dnf" | "snap" | "flatpak" | "script" | "url";

export const softwareCatalog = pgTable(
  "software_catalog",
  {
    id: id(),
    /** null = global catalog shipped with the product. */
    orgId: text("org_id").references(() => organizations.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    publisher: text("publisher"),
    description: text("description"),
    iconUrl: text("icon_url"),
    category: text("category"),
    platform: text("platform").$type<"windows" | "linux" | "macos">().notNull(),
    packageManager: text("package_manager").$type<PackageManager>().notNull(),
    /** Package identifier for the manager (e.g. winget "Google.Chrome", brew "google-chrome"). */
    packageId: text("package_id"),
    version: text("version"),
    downloadUrl: text("download_url"),
    sha256: text("sha256"),
    installArgs: text("install_args"),
    uninstallArgs: text("uninstall_args"),
    installScript: text("install_script"),
    uninstallScript: text("uninstall_script"),
    /** Detection rules: software name match / file path / registry key / command. */
    detection: jsonb("detection").$type<{ type: "software_name" | "file" | "registry" | "command"; value: string; version?: string }[]>().notNull().default([]),
    /** Visible to end users in the self-service portal / tray app. */
    selfService: boolean("self_service").notNull().default(false),
    requiresReboot: boolean("requires_reboot").notNull().default(false),
    licenseType: text("license_type"),
    tags: jsonb("tags").$type<string[]>().notNull().default([]),
    isBuiltin: boolean("is_builtin").notNull().default(false),
    createdBy: text("created_by"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("software_catalog_org_idx").on(t.orgId), index("software_catalog_platform_idx").on(t.platform)],
);

export const softwareLicenses = pgTable(
  "software_licenses",
  {
    id: id(),
    orgId: text("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    vendor: text("vendor"),
    /** Software name pattern used to count installs against seats. */
    matchName: text("match_name"),
    seats: integer("seats"),
    keyEnc: text("key_enc"),
    purchaseDate: tsNullable("purchase_date"),
    expiresAt: tsNullable("expires_at"),
    cost: real("cost"),
    currency: text("currency").default("USD"),
    notes: text("notes"),
    attachments: jsonb("attachments").$type<string[]>().notNull().default([]),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("software_licenses_org_idx").on(t.orgId)],
);

export const patchesRelations = relations(patches, ({ one }) => ({ device: one(devices, { fields: [patches.deviceId], references: [devices.id] }) }));
export const vulnerabilitiesRelations = relations(vulnerabilities, ({ one }) => ({ device: one(devices, { fields: [vulnerabilities.deviceId], references: [devices.id] }) }));
