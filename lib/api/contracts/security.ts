/**
 * Security centre API contracts (posture, findings, benchmarks, admin rotation). No Next.js imports.
 */
import { z } from "zod";
import { csvList, flag, hasTarget, pagination, TargetFields } from "./software";

export const BENCHMARK_FAMILIES = ["windows", "linux", "macos"] as const;
export type BenchmarkFamily = (typeof BENCHMARK_FAMILIES)[number];

export const PostureQuery = pagination.extend({
  platform: csvList.optional(),
  siteId: z.string().optional(),
  status: csvList.optional().describe("Device status filter (online, offline, maintenance)."),
  scoreBelow: z.coerce.number().int().min(0).max(100).optional(),
  failing: z.string().max(60).optional().describe("Only devices failing this posture check id (e.g. `disk_encryption`)."),
  collected: flag.optional().describe("true: only devices with posture data; false: only devices without."),
  sort: z.enum(["score", "name", "findings", "updatedAt", "lastSeenAt"]).optional(),
});
export type PostureQuery = z.infer<typeof PostureQuery>;

export const FindingsQuery = pagination.extend({
  severity: csvList.optional(),
  platform: csvList.optional(),
  siteId: z.string().optional(),
  check: z.string().max(60).optional().describe("Posture check id."),
  deviceId: z.string().optional(),
});
export type FindingsQuery = z.infer<typeof FindingsQuery>;

export const ScanBody = z
  .object({ ...TargetFields, runWhenOnline: z.boolean().default(true) })
  .refine(hasTarget, { message: "deviceIds, groupId, siteId or all is required", path: ["deviceIds"] });
export type ScanBody = z.infer<typeof ScanBody>;

export const BenchmarksQuery = z.object({ family: z.enum(BENCHMARK_FAMILIES).optional() });

export const BenchmarkEvaluateBody = z
  .object({ ...TargetFields, benchmarkId: z.string().max(60).optional().describe("Default: the benchmark matching each device's platform.") })
  .refine(hasTarget, { message: "deviceIds, groupId, siteId or all is required", path: ["deviceIds"] });
export type BenchmarkEvaluateBody = z.infer<typeof BenchmarkEvaluateBody>;

export const BenchmarkResultsQuery = pagination.extend({
  benchmarkId: z.string().max(60).optional(),
  deviceId: z.string().optional().describe("One device: returns its evaluation history (newest first)."),
  platform: csvList.optional(),
  siteId: z.string().optional(),
  checkId: z.string().max(60).optional().describe("Only devices failing this check."),
  sort: z.enum(["score", "name", "failed", "ts"]).optional(),
});
export type BenchmarkResultsQuery = z.infer<typeof BenchmarkResultsQuery>;

export const RotateAdminBody = z.object({
  deviceIds: z.array(z.string()).min(1).max(500),
  username: z.string().trim().regex(/^[A-Za-z0-9._-]{1,104}$/, "letters, digits, . _ - only"),
  length: z.number().int().min(12).max(64).default(20).describe("Generated password length."),
  rotateDays: z.number().int().min(1).max(365).nullable().optional().describe("Store an automatic rotation interval on the vault entry."),
});
export type RotateAdminBody = z.infer<typeof RotateAdminBody>;
