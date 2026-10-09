/**
 * Jobs: the durable command queue. A job targets devices; each device gets a jobRun. Runs are dispatched to
 * online agents immediately and queued for offline ones (dispatched on reconnect while not expired).
 * Feature modules create jobs through createJob(); the jobs module owns dispatching and result handling.
 */
import { and, eq, inArray, isNull, lt, or, sql } from "drizzle-orm";
import { getDb, schema } from "../db";
import { bus } from "../bus";
import { agentRegistry, DeviceOfflineError } from "../realtime/agent-registry";
import type { CommandType, CommandResult } from "../protocol/agent";
import { createLogger } from "../logger";
import { resolveTargets } from "./device-filter";

const log = createLogger("jobs");

export type Job = typeof schema.jobs.$inferSelect;
export type JobRun = typeof schema.jobRuns.$inferSelect;

export interface CreateJobInput {
  orgId: string;
  type: Job["type"];
  name: string;
  targetType: Job["targetType"];
  targetIds?: string[];
  targetFilter?: Record<string, unknown> | null;
  payload?: Record<string, unknown>;
  source?: Job["source"];
  sourceId?: string | null;
  concurrency?: number;
  maxRetries?: number;
  timeoutSeconds?: number;
  runWhenOnline?: boolean;
  respectMaintenanceWindows?: boolean;
  abortOnFailurePercent?: number | null;
  requiresApproval?: boolean;
  scheduledAt?: Date | null;
  expiresAt?: Date | null;
  createdBy?: string | null;
  createdByName?: string | null;
}

/** Translate a job (type + payload) into the agent command envelope for one device. */
export function commandForJob(job: Job, deviceId: string): { cmd: CommandType; args: Record<string, unknown>; runAs?: "system" | "user" | "elevated_user"; timeoutSeconds: number; stream?: boolean } {
  const p = job.payload as Record<string, unknown>;
  const t = job.timeoutSeconds || 600;
  switch (job.type) {
    case "script":
      return { cmd: "run_script", args: { scriptId: p.scriptId, language: p.language, content: p.content, params: p.params ?? {}, outputJson: p.outputJson ?? false, successCodes: p.successCodes ?? [0] }, runAs: (p.runAs as "system") ?? "system", timeoutSeconds: (p.timeoutSeconds as number) || t, stream: true };
    case "command":
      return { cmd: "run_command", args: { command: p.command, shell: p.shell, cwd: p.cwd }, runAs: (p.runAs as "system") ?? "system", timeoutSeconds: t, stream: true };
    case "software_install":
      return { cmd: "software_install", args: { ...p, deviceId }, timeoutSeconds: Math.max(t, 1800) };
    case "software_uninstall":
      return { cmd: "software_uninstall", args: { ...p }, timeoutSeconds: Math.max(t, 1800) };
    case "patch_scan":
      return { cmd: "patch_scan", args: { ...p }, timeoutSeconds: Math.max(t, 1800) };
    case "patch_install":
      return { cmd: "patch_install", args: { ...p }, timeoutSeconds: Math.max(t, 3 * 3600), stream: true };
    case "reboot":
      return { cmd: "reboot", args: { delaySeconds: p.delaySeconds ?? 0, message: p.message, force: p.force ?? false }, timeoutSeconds: 120 };
    case "shutdown":
      return { cmd: "shutdown", args: { delaySeconds: p.delaySeconds ?? 0, message: p.message }, timeoutSeconds: 120 };
    case "wake_on_lan":
      return { cmd: "wake_on_lan", args: { ...p }, timeoutSeconds: 60 };
    case "inventory":
      return { cmd: "inventory", args: { full: p.full ?? true, sections: p.sections }, timeoutSeconds: 600 };
    case "file_push":
      return { cmd: "file_upload", args: { ...p }, timeoutSeconds: Math.max(t, 1800) };
    case "file_pull":
      return { cmd: "file_download", args: { ...p }, timeoutSeconds: Math.max(t, 1800) };
    case "registry":
      return { cmd: (p.action === "delete" ? "registry_delete" : "registry_set") as CommandType, args: { ...p }, timeoutSeconds: 120 };
    case "service_action":
      return { cmd: "service_action", args: { name: p.name, action: p.action, startType: p.startType }, timeoutSeconds: 180 };
    case "process_kill":
      return { cmd: "process_kill", args: { pid: p.pid, name: p.name, force: p.force ?? true }, timeoutSeconds: 60 };
    case "policy_apply":
      return { cmd: "config_update", args: { ...p }, timeoutSeconds: 300 };
    case "agent_update":
      return { cmd: "agent_update", args: { ...p }, timeoutSeconds: 900 };
    case "agent_uninstall":
      return { cmd: "agent_uninstall", args: { ...p }, timeoutSeconds: 300 };
    case "lock_screen":
      return { cmd: "lock", args: {}, timeoutSeconds: 60 };
    case "logoff_user":
      return { cmd: "logoff", args: { ...p }, timeoutSeconds: 60 };
    case "message_user":
      return { cmd: "message_user", args: { title: p.title, body: p.body, timeoutSeconds: p.timeoutSeconds ?? 0, buttons: p.buttons }, timeoutSeconds: Math.max(t, 3600) };
    case "rotate_local_admin":
      return { cmd: "rotate_local_admin", args: { ...p }, timeoutSeconds: 120 };
    case "network_scan":
      return { cmd: "network_scan", args: { ...p }, timeoutSeconds: Math.max(t, 1800) };
    case "security_scan":
      return { cmd: "security_scan", args: { ...p }, timeoutSeconds: Math.max(t, 900) };
    case "clear_cache":
      return { cmd: "run_script", args: { builtin: "clear_cache", ...p }, timeoutSeconds: 600 };
    case "custom":
    default:
      return { cmd: (p.cmd as CommandType) ?? "run_command", args: (p.args as Record<string, unknown>) ?? {}, timeoutSeconds: t, runAs: p.runAs as "system" | undefined, stream: Boolean(p.stream) };
  }
}

export async function createJob(input: CreateJobInput): Promise<{ job: Job; runs: JobRun[] }> {
  const db = await getDb();
  const deviceIds = await resolveTargets(input.orgId, input.targetType, input.targetIds ?? [], input.targetFilter ?? null);
  const status: Job["status"] = input.requiresApproval ? "awaiting_approval" : input.scheduledAt && input.scheduledAt > new Date() ? "queued" : "queued";
  const [job] = await db
    .insert(schema.jobs)
    .values({
      orgId: input.orgId,
      type: input.type,
      name: input.name,
      targetType: input.targetType,
      targetIds: input.targetIds ?? [],
      targetFilter: input.targetFilter ?? null,
      payload: input.payload ?? {},
      status,
      source: input.source ?? "manual",
      sourceId: input.sourceId ?? null,
      concurrency: input.concurrency ?? 0,
      maxRetries: input.maxRetries ?? 0,
      timeoutSeconds: input.timeoutSeconds ?? 600,
      runWhenOnline: input.runWhenOnline ?? true,
      respectMaintenanceWindows: input.respectMaintenanceWindows ?? false,
      abortOnFailurePercent: input.abortOnFailurePercent ?? null,
      requiresApproval: input.requiresApproval ?? false,
      scheduledAt: input.scheduledAt ?? null,
      expiresAt: input.expiresAt ?? (input.runWhenOnline === false ? null : new Date(Date.now() + 7 * 86400_000)),
      createdBy: input.createdBy ?? null,
      createdByName: input.createdByName ?? null,
      stats: { total: deviceIds.length, pending: deviceIds.length, running: 0, succeeded: 0, failed: 0, skipped: 0 },
    })
    .returning();
  const runs = deviceIds.length
    ? await db.insert(schema.jobRuns).values(deviceIds.map((deviceId) => ({ jobId: job.id, orgId: job.orgId, deviceId, status: "pending" as const }))).returning()
    : [];
  bus.publish("job.created", { jobId: job.id, type: job.type, name: job.name, devices: deviceIds.length, status: job.status }, { orgId: job.orgId });
  if (job.status === "queued" && (!job.scheduledAt || job.scheduledAt <= new Date())) void dispatchJob(job.id);
  return { job, runs };
}

/** Dispatch all pending runs of a job (respecting concurrency). */
export async function dispatchJob(jobId: string) {
  const db = await getDb();
  const [job] = await db.select().from(schema.jobs).where(eq(schema.jobs.id, jobId));
  if (!job || !["queued", "running"].includes(job.status)) return;
  if (job.status === "queued") await db.update(schema.jobs).set({ status: "running", startedAt: new Date() }).where(eq(schema.jobs.id, jobId));
  const pending = await db.select().from(schema.jobRuns).where(and(eq(schema.jobRuns.jobId, jobId), inArray(schema.jobRuns.status, ["pending", "offline_queued"])));
  if (!pending.length) return finalizeIfDone(jobId);
  let slots = job.concurrency > 0 ? Math.max(0, job.concurrency - (await countRunning(jobId))) : Number.POSITIVE_INFINITY;
  for (const run of pending) {
    if (slots <= 0) break;
    if (!agentRegistry.isOnline(run.deviceId)) {
      if (run.status !== "offline_queued") await db.update(schema.jobRuns).set({ status: job.runWhenOnline ? "offline_queued" : "skipped", error: job.runWhenOnline ? null : "device offline" }).where(eq(schema.jobRuns.id, run.id));
      continue;
    }
    slots--;
    void executeRun(job, run);
  }
  await refreshStats(jobId);
}

async function countRunning(jobId: string) {
  const db = await getDb();
  const [r] = await db.select({ n: sql<number>`count(*)::int` }).from(schema.jobRuns).where(and(eq(schema.jobRuns.jobId, jobId), inArray(schema.jobRuns.status, ["sent", "running"])));
  return r.n;
}

export async function executeRun(job: Job, run: JobRun) {
  const db = await getDb();
  const envelope = commandForJob(job, run.deviceId);
  await db.update(schema.jobRuns).set({ status: "sent", sentAt: new Date(), command: envelope as unknown as Record<string, unknown> }).where(eq(schema.jobRuns.id, run.id));
  bus.publish("job.run.updated", { jobId: job.id, runId: run.id, deviceId: run.deviceId, status: "sent" }, { orgId: job.orgId, deviceId: run.deviceId });
  const started = Date.now();
  let stdoutLen = 0;
  try {
    const result = await agentRegistry.command(run.deviceId, envelope.cmd, envelope.args, {
      id: run.id,
      timeoutSeconds: envelope.timeoutSeconds,
      runAs: envelope.runAs,
      stream: envelope.stream,
      onOutput: envelope.stream
        ? (stream, data) => {
            stdoutLen += data.length;
            if (stdoutLen < 2_000_000) bus.publish("job.run.output", { jobId: job.id, runId: run.id, deviceId: run.deviceId, stream, data }, { orgId: job.orgId, deviceId: run.deviceId });
          }
        : undefined,
    });
    await completeRun(run.id, result, Date.now() - started);
  } catch (err) {
    const offline = err instanceof DeviceOfflineError;
    const timeout = /timed out/i.test(String(err));
    if (offline && job.runWhenOnline) {
      await db.update(schema.jobRuns).set({ status: "offline_queued", error: "device went offline; queued" }).where(eq(schema.jobRuns.id, run.id));
    } else if (run.attempt <= job.maxRetries) {
      await db.update(schema.jobRuns).set({ status: "pending", attempt: run.attempt + 1, error: String((err as Error).message || err) }).where(eq(schema.jobRuns.id, run.id));
      setTimeout(() => void dispatchJob(job.id), 5_000).unref();
    } else {
      await db.update(schema.jobRuns).set({ status: timeout ? "timeout" : "failed", finishedAt: new Date(), error: String((err as Error).message || err), durationMs: Date.now() - started }).where(eq(schema.jobRuns.id, run.id));
    }
    bus.publish("job.run.updated", { jobId: job.id, runId: run.id, deviceId: run.deviceId, status: timeout ? "timeout" : offline ? "offline_queued" : "failed", error: String((err as Error).message || err) }, { orgId: job.orgId, deviceId: run.deviceId });
    await refreshStats(job.id);
    await finalizeIfDone(job.id);
    void dispatchJob(job.id);
  }
}

/** Store a result for a run (also used when an orphaned result arrives after a server restart). */
export async function completeRun(runId: string, result: CommandResult, durationMs?: number) {
  const db = await getDb();
  const [run] = await db.select().from(schema.jobRuns).where(eq(schema.jobRuns.id, runId));
  if (!run) return;
  const [job] = await db.select().from(schema.jobs).where(eq(schema.jobs.id, run.jobId));
  const successCodes = ((job?.payload as Record<string, unknown>)?.successCodes as number[] | undefined) ?? [0];
  const ok = result.ok && (result.exitCode === undefined || successCodes.includes(result.exitCode));
  const cap = (s?: string) => (s && s.length > 1_000_000 ? s.slice(0, 1_000_000) + "\n…[truncated]" : s);
  await db
    .update(schema.jobRuns)
    .set({ status: ok ? "succeeded" : "failed", finishedAt: new Date(), exitCode: result.exitCode ?? null, stdout: cap(result.stdout) ?? null, stderr: cap(result.stderr) ?? null, output: (result.data as Record<string, unknown>) ?? null, error: ok ? null : result.error ?? `exit code ${result.exitCode}`, durationMs: result.durationMs ?? durationMs ?? null })
    .where(eq(schema.jobRuns.id, runId));
  bus.publish("job.run.updated", { jobId: run.jobId, runId, deviceId: run.deviceId, status: ok ? "succeeded" : "failed", exitCode: result.exitCode, type: job?.type, output: result.data }, { orgId: run.orgId, deviceId: run.deviceId });
  if (job) {
    bus.publish(ok ? "job.run.succeeded" : "job.run.failed", { jobId: job.id, runId, deviceId: run.deviceId, type: job.type, payload: job.payload, output: result.data, exitCode: result.exitCode, stdout: result.stdout?.slice(0, 20_000), stderr: result.stderr?.slice(0, 20_000) }, { orgId: run.orgId, deviceId: run.deviceId });
    await refreshStats(job.id);
    await finalizeIfDone(job.id);
    if (job.abortOnFailurePercent) {
      const j = (await db.select().from(schema.jobs).where(eq(schema.jobs.id, job.id)))[0];
      const done = j.stats.succeeded + j.stats.failed;
      if (done >= 3 && (j.stats.failed / done) * 100 >= job.abortOnFailurePercent && j.status === "running") {
        await cancelJob(job.id, "aborted: failure threshold exceeded");
        return;
      }
    }
    void dispatchJob(job.id);
  }
}

export async function refreshStats(jobId: string) {
  const db = await getDb();
  const rows = await db.select({ status: schema.jobRuns.status, n: sql<number>`count(*)::int` }).from(schema.jobRuns).where(eq(schema.jobRuns.jobId, jobId)).groupBy(schema.jobRuns.status);
  const stats = { total: 0, pending: 0, running: 0, succeeded: 0, failed: 0, skipped: 0 };
  for (const r of rows) {
    stats.total += r.n;
    if (r.status === "pending" || r.status === "offline_queued") stats.pending += r.n;
    else if (r.status === "sent" || r.status === "running") stats.running += r.n;
    else if (r.status === "succeeded") stats.succeeded += r.n;
    else if (r.status === "failed" || r.status === "timeout") stats.failed += r.n;
    else stats.skipped += r.n;
  }
  await db.update(schema.jobs).set({ stats }).where(eq(schema.jobs.id, jobId));
  return stats;
}

async function finalizeIfDone(jobId: string) {
  const db = await getDb();
  const [job] = await db.select().from(schema.jobs).where(eq(schema.jobs.id, jobId));
  if (!job || job.status !== "running") return;
  const s = job.stats;
  if (s.pending > 0 || s.running > 0) return;
  const status: Job["status"] = s.failed === 0 ? "completed" : s.succeeded === 0 ? "failed" : "partial";
  await db.update(schema.jobs).set({ status, completedAt: new Date() }).where(eq(schema.jobs.id, jobId));
  bus.publish(status === "failed" ? "job.failed" : "job.completed", { jobId, type: job.type, name: job.name, status, stats: s, sourceId: job.sourceId, source: job.source, payload: job.payload }, { orgId: job.orgId });
  log.info("job finished", { jobId, status, ...s });
}

export async function cancelJob(jobId: string, reason = "cancelled") {
  const db = await getDb();
  const [job] = await db.select().from(schema.jobs).where(eq(schema.jobs.id, jobId));
  if (!job) return;
  await db.update(schema.jobRuns).set({ status: "cancelled", finishedAt: new Date(), error: reason }).where(and(eq(schema.jobRuns.jobId, jobId), inArray(schema.jobRuns.status, ["pending", "offline_queued", "sent", "running"])));
  for (const run of await db.select().from(schema.jobRuns).where(and(eq(schema.jobRuns.jobId, jobId), eq(schema.jobRuns.status, "cancelled")))) {
    if (agentRegistry.isLocal(run.deviceId)) agentRegistry.command(run.deviceId, "cancel", { id: run.id }, { timeoutSeconds: 10 }).catch(() => {});
  }
  await refreshStats(jobId);
  await db.update(schema.jobs).set({ status: "cancelled", completedAt: new Date() }).where(eq(schema.jobs.id, jobId));
  bus.publish("job.cancelled", { jobId, reason }, { orgId: job.orgId });
}

export async function approveJob(jobId: string, userId: string) {
  const db = await getDb();
  await db.update(schema.jobs).set({ status: "queued", approvedBy: userId }).where(and(eq(schema.jobs.id, jobId), eq(schema.jobs.status, "awaiting_approval")));
  void dispatchJob(jobId);
}

/** When a device comes online, dispatch its queued runs (oldest first). */
export async function dispatchQueuedForDevice(deviceId: string) {
  const db = await getDb();
  const runs = await db
    .select({ id: schema.jobRuns.id, jobId: schema.jobRuns.jobId })
    .from(schema.jobRuns)
    .innerJoin(schema.jobs, eq(schema.jobs.id, schema.jobRuns.jobId))
    .where(and(eq(schema.jobRuns.deviceId, deviceId), inArray(schema.jobRuns.status, ["pending", "offline_queued"]), inArray(schema.jobs.status, ["queued", "running"]), or(isNull(schema.jobs.expiresAt), sql`${schema.jobs.expiresAt} > now()`)))
    .orderBy(schema.jobRuns.createdAt);
  const jobIds = [...new Set(runs.map((r) => r.jobId))];
  for (const id of jobIds) await dispatchJob(id);
}

/** Expire stale queued runs, mark jobs whose scheduledAt arrived as queued, and nudge running jobs. */
export async function tickJobs() {
  const db = await getDb();
  const now = new Date();
  const expired = await db
    .select({ id: schema.jobs.id })
    .from(schema.jobs)
    .where(and(inArray(schema.jobs.status, ["queued", "running"]), lt(schema.jobs.expiresAt, now)));
  for (const j of expired) {
    await db.update(schema.jobRuns).set({ status: "skipped", finishedAt: now, error: "expired before device came online" }).where(and(eq(schema.jobRuns.jobId, j.id), inArray(schema.jobRuns.status, ["pending", "offline_queued"])));
    await refreshStats(j.id);
    await finalizeIfDone(j.id);
  }
  const due = await db.select({ id: schema.jobs.id }).from(schema.jobs).where(and(eq(schema.jobs.status, "queued"), lt(schema.jobs.scheduledAt, now)));
  for (const j of due) await dispatchJob(j.id);
  const running = await db.select({ id: schema.jobs.id }).from(schema.jobs).where(eq(schema.jobs.status, "running"));
  for (const j of running) await dispatchJob(j.id);
  // runs stuck in "sent" longer than their timeout + grace (node restarted mid-run)
  const stuck = await db
    .select({ id: schema.jobRuns.id, jobId: schema.jobRuns.jobId, sentAt: schema.jobRuns.sentAt, timeout: schema.jobs.timeoutSeconds })
    .from(schema.jobRuns)
    .innerJoin(schema.jobs, eq(schema.jobs.id, schema.jobRuns.jobId))
    .where(inArray(schema.jobRuns.status, ["sent", "running"]));
  for (const r of stuck) {
    if (r.sentAt && now.getTime() - r.sentAt.getTime() > (Math.max(r.timeout, 600) + 300) * 1000) {
      await db.update(schema.jobRuns).set({ status: "timeout", finishedAt: now, error: "no result received" }).where(eq(schema.jobRuns.id, r.id));
      await refreshStats(r.jobId);
      await finalizeIfDone(r.jobId);
    }
  }
}
