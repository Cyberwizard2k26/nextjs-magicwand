/**
 * Vulnerability API contracts shared by the routes and the OpenAPI area file. No Next.js imports.
 */
import { z } from "zod";
import { Canary, csvList, flag, pagination } from "./software";

export const VULN_SEVERITIES = ["critical", "high", "medium", "low", "unknown"] as const;
export type VulnSeverity = (typeof VULN_SEVERITIES)[number];
export const VULN_STATUSES = ["open", "mitigated", "resolved", "accepted", "false_positive"] as const;
export type VulnStatus = (typeof VULN_STATUSES)[number];
export const VULN_SOURCES = ["osv", "nvd", "msrc", "vendor", "agent"] as const;

export const cveId = z.string().trim().regex(/^CVE-\d{4}-\d{4,}$/i, "Expected a CVE id like CVE-2024-12345").transform((s) => s.toUpperCase());

export const VulnListQuery = pagination.extend({
  severity: csvList.optional().describe("critical | high | medium | low | unknown (comma separated)."),
  status: csvList.optional().describe("Row status filter; default `open`. Use `all` for every status."),
  kev: flag.optional().describe("Only CVEs on the known-exploited list."),
  fixAvailable: flag.optional().describe("Only CVEs with a fixed version / patch known."),
  deviceId: z.string().optional(),
  siteId: z.string().optional(),
  platform: csvList.optional(),
  source: csvList.optional(),
  packageName: z.string().max(300).optional(),
  sync: flag.optional().describe("Force the patch-to-CVE sync before listing (normally memoised for 5 minutes)."),
  sort: z.enum(["risk", "severity", "cvss", "devices", "detectedAt", "cveId"]).optional(),
});
export type VulnListQuery = z.infer<typeof VulnListQuery>;

export const VulnImportRow = z.object({
  cveId,
  title: z.string().max(500).optional(),
  severity: z.enum(VULN_SEVERITIES).optional().describe("Derived from CVSS when omitted."),
  cvss: z.coerce.number().min(0).max(10).optional(),
  epss: z.coerce.number().min(0).max(1).optional(),
  packageName: z.string().max(300).optional(),
  installedVersion: z.string().max(200).optional(),
  fixedVersion: z.string().max(200).optional(),
  deviceId: z.string().optional().describe("Target device id; or give `hostname`."),
  hostname: z.string().max(253).optional().describe("Resolved case-insensitively against device hostname / name."),
  knownExploited: z.boolean().optional(),
  references: z.array(z.string().max(2000)).max(50).optional(),
});
export type VulnImportRow = z.infer<typeof VulnImportRow>;

export const VulnImportBody = z
  .object({
    items: z.array(VulnImportRow).max(50_000).optional().describe("JSON rows (scanner export)."),
    csv: z.string().max(20_000_000).optional().describe("CSV text with a header row. Recognised columns: cveId/cve, title, severity, cvss, epss, packageName/package, installedVersion, fixedVersion, deviceId, hostname/host."),
    source: z.enum(VULN_SOURCES).default("vendor"),
  })
  .refine((b) => !!(b.items?.length || b.csv), { message: "items or csv is required", path: ["items"] });
export type VulnImportBody = z.infer<typeof VulnImportBody>;

export const VulnStatusBody = z.object({
  status: z.enum(VULN_STATUSES),
  note: z.string().max(2000).optional().describe("Why: stored with the row and shown in the drill-down."),
  deviceIds: z.array(z.string()).max(5000).optional().describe("Only these devices' rows; default: every device affected by the CVE."),
});
export type VulnStatusBody = z.infer<typeof VulnStatusBody>;

export const VulnRemediateBody = z.object({
  deviceIds: z.array(z.string()).max(5000).optional().describe("Default: every affected device with a known patch."),
  canary: Canary.optional(),
});
export type VulnRemediateBody = z.infer<typeof VulnRemediateBody>;

export const KevBody = z
  .object({
    cveIds: z.array(cveId).max(20_000).optional(),
    /** CISA KEV catalog JSON shape (`{"vulnerabilities":[{"cveID":"CVE-..."}]}`) can be posted as-is. */
    vulnerabilities: z.array(z.object({ cveID: z.string() }).loose()).max(20_000).optional(),
    replace: z.boolean().default(true).describe("Replace the list (true) or merge into it (false)."),
  })
  .refine((b) => !!(b.cveIds || b.vulnerabilities), { message: "cveIds or vulnerabilities is required", path: ["cveIds"] });
export type KevBody = z.infer<typeof KevBody>;
