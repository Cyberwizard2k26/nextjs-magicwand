/**
 * Job creation as used by the API and the UI wizard: permission checks per job type, payload validation and
 * canary rollouts. A canary rollout runs the job on a small first wave; the second wave is created as a job
 * awaiting approval and is promoted automatically when the canary finishes with zero failures (or by hand).
 */
import { z } from "zod";
import { errors } from "../api/route";
import { can, type Principal } from "../auth/session";
import type { Permission } from "../rbac/permissions";
import type { JobType } from "../db/schema/automation";
import { getDb, schema } from "../db";
import { eq, inArray, and } from "drizzle-orm";
import { createJob, type Job, type JobRun } from "./jobs";
import { resolveTargets } from "./device-filter";
import { siteScope } from "./device-access";

export const JOB_TYPE_PERMISSION: Record<JobType, Permission> = {
  script: "scripts.run",
  command: "scripts.run",
  clear_cache: "scripts.run",
  custom: "scripts.run_high_risk",
  software_install: "software.manage",
  software_uninstall: "software.manage",
  patch_scan: "patches.view",
  patch_install: "patches.manage",
  reboot: "devices.power",
  shutdown: "devices.power",
  wake_on_lan: "devices.power",
  lock_screen: "devices.power",
  logoff_user: "devices.power",
  inventory: "devices.manage",
  file_push: "remote.files",
  file_pull: "remote.files",
  registry: "remote.tools",
  service_action: "remote.tools",
  process_kill: "remote.tools",
  message_user: "remote.tools",
  policy_apply: "policies.manage",
  agent_update: "devices.manage",
  agent_uninstall: "devices.delete",
  rotate_local_admin: "security.manage",
  network_scan: "network.manage",
  security_scan: "security.manage",
};

export const JobTypeSchema = z.enum(Object.keys(JOB_TYPE_PERMISSION) as [JobType, ...JobType[]]);

export const CreateJobBody = z.object({
  type: JobTypeSchema,
  name: z.string().min(1).max(200).optional(),
  targetType: z.enum(["device", "group", "site", "org", "filter"]),
  targetIds: z.array(z.string()).max(5000).default([]),
  targetFilter: z.record(z.string(), z.unknown()).nullable().optional(),
  payload: z.record(z.string(), z.unknown()).default({}),
  concurrency: z.number().int().min(0).max(10000).optional(),
  maxRetries: z.number().int().min(0).max(10).optional(),
  timeoutSeconds: z.number().int().positive().max(24 * 3600).optional(),
  runWhenOnline: z.boolean().optional(),
  abortOnFailurePercent: z.number().int().min(1).max(100).nullable().optional(),
  requiresApproval: z.boolean().optional(),
  scheduledAt: z.string().datetime({ offset: true }).nullable().optional(),
  expiresInHours: z.number().positive().max(24 * 90).optional(),
  /** Canary rollout: run on `count` devices first; promote the rest automatically when the canary is clean. */
  canary: z.object({ count: z.number().int().min(1).max(1000), autoPromote: z.boolean().default(true) }).optional(),
});
export type CreateJobBody = z.infer<typeof CreateJobBody>;

const DEFAULT_NAMES: Partial<Record<JobType, (p: Record<string, unknown>) => string>> = {
  command: (p) => `Run: ${String(p.command ?? "").slice(0, 80)}`,
  script: (p) => `Script: ${String(p.name ?? p.scriptId ?? "ad-hoc")}`,
  reboot: () => "Reboot",
  shutdown: () => "Shut down",
  lock_screen: () => "Lock screen",
  logoff_user: () => "Log off user",
  inventory: () => "Refresh inventory",
  clear_cache: () => "Clear temporary files",
  message_user: (p) => `Message: ${String(p.title ?? "").slice(0, 60)}`,
  agent_update: () => "Update agent",
};

export function defaultJobName(type: JobType, payload: Record<string, unknown>): string {
  return DEFAULT_NAMES[type]?.(payload) ?? type.replace(/_/g, " ");
}

/** Resolve a script reference in the payload into the content the agent needs (and inherit its defaults). */
async function hydrateScriptPayload(orgId: string, body: CreateJobBody): Promise<{ payload: Record<string, unknown>; risk: "low" | "medium" | "high"; requiresApproval: boolean; name?: string; timeoutSeconds?: number }> {
  const payload = { ...body.payload };
  if (body.type !== "script" || typeof payload.scriptId !== "string") return { payload, risk: "low", requiresApproval: false };
  const db = await getDb();
  const [script] = await db.select().from(schema.scripts).where(eq(schema.scripts.id, payload.scriptId));
  if (!script || (script.orgId && script.orgId !== orgId)) throw errors.notFound("Script not found");
  for (const p of script.parameters) {
    const params = (payload.params ?? {}) as Record<string, unknown>;
    if (p.required && (params[p.name] === undefined || params[p.name] === "")) throw errors.badRequest(`Parameter "${p.label || p.name}" is required`);
  }
  return {
    payload: { ...payload, name: script.name, language: script.language, content: script.content, outputJson: script.outputJson, successCodes: script.successCodes, runAs: payload.runAs ?? script.runAs, timeoutSeconds: payload.timeoutSeconds ?? script.timeoutSeconds, scriptVersion: script.version },
    risk: script.risk,
    requiresApproval: script.requiresApproval,
    name: script.name,
    timeoutSeconds: script.timeoutSeconds,
  };
}

export async function createJobFromRequest(principal: Principal, orgId: string, body: CreateJobBody): Promise<{ job: Job; runs: JobRun[]; rollout?: Job }> {
  const permission = JOB_TYPE_PERMISSION[body.type];
  if (!can(principal, permission, orgId)) throw errors.forbidden(`Creating a "${body.type}" job requires the "${permission}" permission`);
  if (body.type === "command" && !String(body.payload.command ?? "").trim()) throw errors.badRequest("command is required");
  const hydrated = await hydrateScriptPayload(orgId, body);
  if (hydrated.risk === "high" && !can(principal, "scripts.run_high_risk", orgId)) throw errors.forbidden("This script is classified high risk and requires the \"scripts.run_high_risk\" permission");
  const scope = siteScope(principal, orgId);
  const who = { createdBy: principal.user?.id ?? null, createdByName: principal.user?.name ?? principal.user?.email ?? principal.apiKey?.name ?? null };
  const name = body.name ?? defaultJobName(body.type, { ...body.payload, name: hydrated.name });
  const common = {
    orgId,
    type: body.type,
    payload: hydrated.payload,
    source: "manual" as const,
    concurrency: body.concurrency,
    maxRetries: body.maxRetries,
    timeoutSeconds: body.timeoutSeconds ?? hydrated.timeoutSeconds,
    runWhenOnline: body.runWhenOnline,
    abortOnFailurePercent: body.abortOnFailurePercent ?? undefined,
    requiresApproval: body.requiresApproval || hydrated.requiresApproval,
    scheduledAt: body.scheduledAt ? new Date(body.scheduledAt) : null,
    expiresAt: body.expiresInHours ? new Date(Date.now() + body.expiresInHours * 3600_000) : undefined,
    scopeSiteIds: scope,
    ...who,
  };

  if (!body.canary) {
    const { job, runs } = await createJob({ ...common, name, targetType: body.targetType, targetIds: body.targetIds, targetFilter: body.targetFilter ?? null });
    return { job, runs };
  }

  // Canary: split the resolved target set deterministically (spread across platforms when possible).
  let ids = await resolveTargets(orgId, body.targetType, body.targetIds, body.targetFilter ?? null);
  if (scope?.length && ids.length) {
    const db = await getDb();
    const allowed = new Set((await db.select({ id: schema.devices.id }).from(schema.devices).where(and(inArray(schema.devices.id, ids), inArray(schema.devices.siteId, scope)))).map((r) => r.id));
    ids = ids.filter((id) => allowed.has(id));
  }
  if (ids.length <= body.canary.count) {
    const { job, runs } = await createJob({ ...common, name, targetType: "device", targetIds: ids });
    return { job, runs };
  }
  const canaryIds = ids.slice(0, body.canary.count);
  const restIds = ids.slice(body.canary.count);
  const { job, runs } = await createJob({ ...common, name: `${name} · canary (${canaryIds.length} of ${ids.length})`, targetType: "device", targetIds: canaryIds, abortOnFailurePercent: body.abortOnFailurePercent ?? 1 });
  const { job: rollout } = await createJob({
    ...common,
    name: `${name} · rollout (${restIds.length} of ${ids.length})`,
    targetType: "device",
    targetIds: restIds,
    requiresApproval: true,
    sourceId: job.id,
    payload: { ...hydrated.payload, canaryOf: job.id, autoPromote: body.canary.autoPromote },
  });
  return { job, runs, rollout };
}
