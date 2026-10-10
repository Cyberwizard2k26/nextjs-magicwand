/**
 * Toolbox contracts: zod schemas shared by the API routes (validation) and the OpenAPI registry (documentation).
 * Keep this file free of server-only imports so the client bundle can import the constants.
 */
import { z } from "zod";

export const TOOLBOX_CATEGORIES = [
  "Diagnostics",
  "Repair",
  "Cleanup",
  "Security",
  "Users & sessions",
  "Network",
  "Software & updates",
  "Printing",
  "Power",
  "Agent & RMM",
  "Custom",
] as const;
export type ToolboxCategory = (typeof TOOLBOX_CATEGORIES)[number];

export const TOOL_LANGUAGES = ["powershell", "bash", "sh", "zsh", "python", "cmd", "node", "applescript"] as const;
export type ToolLanguage = (typeof TOOL_LANGUAGES)[number];
export const TOOL_PLATFORMS = ["windows", "linux", "macos", "freebsd"] as const;
export type ToolPlatform = (typeof TOOL_PLATFORMS)[number];
export const TOOL_RISKS = ["low", "medium", "high"] as const;
export type ToolRisk = (typeof TOOL_RISKS)[number];
export const TOOL_RUN_AS = ["system", "user", "elevated_user"] as const;
export type ToolRunAs = (typeof TOOL_RUN_AS)[number];
export const TOOL_KINDS = ["script", "binary"] as const;
export type ToolKind = (typeof TOOL_KINDS)[number];

/** Uploaded files with these extensions become editable script tools. */
export const SCRIPT_EXTENSIONS: Record<string, ToolLanguage> = {
  ".ps1": "powershell",
  ".bat": "cmd",
  ".cmd": "cmd",
  ".sh": "bash",
  ".bash": "bash",
  ".zsh": "zsh",
  ".py": "python",
  ".js": "node",
  ".mjs": "node",
  ".cjs": "node",
  ".scpt": "applescript",
  ".applescript": "applescript",
};
/** Uploaded files with these extensions are stored as binary tools and delivered to the agent over a signed URL. */
export const BINARY_EXTENSIONS = [".exe", ".msi", ".pkg", ".deb", ".rpm", ".zip"] as const;
export type BinaryExtension = (typeof BINARY_EXTENSIONS)[number];
export const ALLOWED_UPLOAD_EXTENSIONS = [...Object.keys(SCRIPT_EXTENSIONS), ...BINARY_EXTENSIONS];
export const MAX_UPLOAD_BYTES = 200 * 1024 * 1024;
/** Signed download links stay valid this long (the agent downloads right after the job is dispatched). */
export const DOWNLOAD_TTL_SECONDS = 15 * 60;
/** Every job the toolbox creates is named with this prefix so run history can be filtered. */
export const TOOLBOX_JOB_PREFIX = "Toolbox: ";

/** Default platforms for a binary extension (used when the uploader does not say). */
export const BINARY_DEFAULT_PLATFORMS: Record<BinaryExtension, ToolPlatform[]> = {
  ".exe": ["windows"],
  ".msi": ["windows"],
  ".pkg": ["macos"],
  ".deb": ["linux"],
  ".rpm": ["linux"],
  ".zip": ["windows", "linux", "macos"],
};

export const ToolParameter = z.object({
  name: z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/, "letters, digits and underscores only").max(64),
  label: z.string().max(120).optional(),
  type: z.enum(["string", "number", "boolean", "select", "secret", "device_field"]),
  required: z.boolean().optional(),
  default: z.union([z.string(), z.number(), z.boolean()]).optional(),
  options: z.array(z.string().max(200)).max(100).optional(),
  description: z.string().max(500).optional(),
});
export type ToolParameter = z.infer<typeof ToolParameter>;

export const ToolboxListQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(500).default(500),
  q: z.string().max(200).optional(),
  category: z.string().max(80).optional(),
  platform: z.enum(TOOL_PLATFORMS).optional(),
  kind: z.enum(["script", "binary", "all"]).default("all"),
  source: z.enum(["builtin", "custom", "all"]).default("all"),
  language: z.enum(TOOL_LANGUAGES).optional(),
  risk: z.enum(TOOL_RISKS).optional(),
  favorites: z.coerce.boolean().optional(),
  sort: z.enum(["name", "category", "updatedAt", "risk"]).default("category"),
  dir: z.enum(["asc", "desc"]).default("asc"),
});
export type ToolboxListQuery = z.infer<typeof ToolboxListQuery>;

export const CreateToolBody = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(4000).nullable().optional(),
  language: z.enum(TOOL_LANGUAGES),
  content: z.string().min(1).max(512_000),
  platforms: z.array(z.enum(TOOL_PLATFORMS)).max(4).default([]),
  category: z.string().min(1).max(80).default("Custom"),
  parameters: z.array(ToolParameter).max(50).default([]),
  timeoutSeconds: z.number().int().positive().max(24 * 3600).default(600),
  runAs: z.enum(TOOL_RUN_AS).default("system"),
  risk: z.enum(TOOL_RISKS).default("low"),
  tags: z.array(z.string().max(60)).max(30).default([]),
  successCodes: z.array(z.number().int()).max(20).default([0]),
  outputJson: z.boolean().default(false),
  requiresApproval: z.boolean().default(false),
});
export type CreateToolBody = z.infer<typeof CreateToolBody>;

/** Script tools accept every field; binary tools accept the metadata subset (language/content are ignored for them). */
export const UpdateToolBody = CreateToolBody.partial().extend({
  args: z.string().max(2000).optional(),
  entry: z.string().max(500).optional(),
});
export type UpdateToolBody = z.infer<typeof UpdateToolBody>;

export const RunToolBody = z.object({
  deviceIds: z.array(z.string().min(1)).min(1).max(5000),
  params: z.record(z.string(), z.unknown()).default({}),
  runAs: z.enum(TOOL_RUN_AS).optional(),
  timeoutSeconds: z.number().int().positive().max(24 * 3600).optional(),
  /** Optional job name override; defaults to "Toolbox: <tool name>". */
  name: z.string().min(1).max(200).optional(),
  /** Run on online devices only; offline devices are skipped instead of queued. */
  onlineOnly: z.boolean().default(false),
});
export type RunToolBody = z.infer<typeof RunToolBody>;

/** JSON "metadata" field of the multipart upload. Everything is optional; sensible defaults are derived from the file. */
export const UploadMetadata = z.object({
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(4000).nullable().optional(),
  category: z.string().min(1).max(80).optional(),
  platforms: z.array(z.enum(TOOL_PLATFORMS)).max(4).optional(),
  /** Script uploads only: override the language detected from the extension. */
  language: z.enum(TOOL_LANGUAGES).optional(),
  parameters: z.array(ToolParameter).max(50).optional(),
  timeoutSeconds: z.number().int().positive().max(24 * 3600).optional(),
  runAs: z.enum(TOOL_RUN_AS).optional(),
  risk: z.enum(TOOL_RISKS).optional(),
  tags: z.array(z.string().max(60)).max(30).optional(),
  /** Installer tools: extra command-line arguments (msiexec properties, /S flags ...). */
  args: z.string().max(2000).optional(),
  /** Zip tools: command executed inside the extracted folder, e.g. "setup.exe /S" or "./install.sh". */
  entry: z.string().max(500).optional(),
});
export type UploadMetadata = z.infer<typeof UploadMetadata>;

export const DownloadQuery = z.object({
  sig: z.string().regex(/^[a-f0-9]{64}$/, "hex HMAC-SHA256"),
  exp: z.coerce.number().int().positive(),
});

export const FavoriteBody = z.object({ favorite: z.boolean() });

export const DuplicateBody = z.object({ name: z.string().min(1).max(200).optional() });

export const ImportBody = z.object({
  tools: z.array(CreateToolBody).min(1).max(500),
  /** When true, a custom tool with the same name and language is overwritten instead of skipped. */
  replace: z.boolean().default(false),
});
export type ImportBody = z.infer<typeof ImportBody>;

export const ExportQuery = z.object({
  /** Include the shipped library too (default: custom tools only). */
  includeBuiltins: z.coerce.boolean().default(false),
});

/* ------------------------------------------------------------------ response shapes (documentation) */

export const ToolSummary = z.object({
  id: z.string(),
  kind: z.enum(TOOL_KINDS),
  key: z.string().describe("Groups platform variants of the same tool (e.g. the PowerShell and bash 'System report')."),
  name: z.string(),
  description: z.string().nullable(),
  category: z.string(),
  platforms: z.array(z.enum(TOOL_PLATFORMS)).describe("Empty = any platform."),
  language: z.enum(TOOL_LANGUAGES).nullable().describe("null for binary tools."),
  parameters: z.array(ToolParameter),
  timeoutSeconds: z.number().int(),
  runAs: z.enum(TOOL_RUN_AS),
  risk: z.enum(TOOL_RISKS),
  tags: z.array(z.string()),
  isBuiltin: z.boolean(),
  isFavorite: z.boolean().describe("Per-user favourite flag."),
  orgId: z.string().nullable(),
  version: z.number().int(),
  requiresApproval: z.boolean(),
  action: z.string().nullable().describe("Set for tools that map to a native job type (inventory, patch_scan) instead of running a script."),
  filename: z.string().nullable(),
  sizeBytes: z.number().nullable(),
  sha256: z.string().nullable(),
  args: z.string().nullable(),
  entry: z.string().nullable(),
  runCount: z.number().int().describe("Toolbox jobs created from this tool in the active organization."),
  lastRunAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export const ToolDetail = ToolSummary.extend({
  content: z.string().nullable().describe("Script content (null for binary tools)."),
  successCodes: z.array(z.number().int()),
  outputJson: z.boolean(),
  recentJobs: z.array(z.object({ id: z.string(), name: z.string(), status: z.string(), stats: z.record(z.string(), z.number()), createdAt: z.string(), createdByName: z.string().nullable() })),
});
export const ToolList = z.object({ items: z.array(ToolSummary), total: z.number().int(), page: z.number().int(), pageSize: z.number().int(), pages: z.number().int() });
export const CategoryCounts = z.object({
  items: z.array(z.object({ category: z.string(), total: z.number().int(), builtin: z.number().int(), custom: z.number().int(), binaries: z.number().int() })),
  total: z.number().int(),
});
export const RunResult = z.object({
  job: z.record(z.string(), z.unknown()).describe("The first job created (one per language variant / binary target group)."),
  jobs: z.array(z.record(z.string(), z.unknown())),
  runs: z.array(z.record(z.string(), z.unknown())).describe("All per-device runs across the created jobs."),
  skipped: z.array(z.object({ deviceId: z.string(), deviceName: z.string().nullable(), reason: z.string() })),
});
