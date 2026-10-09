import { and, asc, eq } from "drizzle-orm";
import { api, errors } from "@/lib/api/route";
import { getDb, schema } from "@/lib/db";
import { agentRegistry } from "@/lib/realtime/agent-registry";

export const dynamic = "force-dynamic";

/** One job with all of its per-device runs (output excluded - fetch a run for its stdout/stderr). */
export const GET = api({ permission: "jobs.view" }, async ({ orgId, params }) => {
  const db = await getDb();
  const [job] = await db.select().from(schema.jobs).where(and(eq(schema.jobs.id, params.id), eq(schema.jobs.orgId, orgId)));
  if (!job) throw errors.notFound("Job not found");
  const runs = await db
    .select({
      id: schema.jobRuns.id,
      deviceId: schema.jobRuns.deviceId,
      status: schema.jobRuns.status,
      attempt: schema.jobRuns.attempt,
      sentAt: schema.jobRuns.sentAt,
      finishedAt: schema.jobRuns.finishedAt,
      exitCode: schema.jobRuns.exitCode,
      error: schema.jobRuns.error,
      durationMs: schema.jobRuns.durationMs,
      output: schema.jobRuns.output,
      deviceName: schema.devices.name,
      platform: schema.devices.platform,
      deviceStatus: schema.devices.status,
    })
    .from(schema.jobRuns)
    .leftJoin(schema.devices, eq(schema.devices.id, schema.jobRuns.deviceId))
    .where(eq(schema.jobRuns.jobId, job.id))
    .orderBy(asc(schema.jobRuns.createdAt));
  const related = job.sourceId ? (await db.select({ id: schema.jobs.id, name: schema.jobs.name, status: schema.jobs.status, stats: schema.jobs.stats }).from(schema.jobs).where(and(eq(schema.jobs.id, job.sourceId), eq(schema.jobs.orgId, orgId))))[0] ?? null : null;
  const [rollout] = await db.select({ id: schema.jobs.id, name: schema.jobs.name, status: schema.jobs.status, stats: schema.jobs.stats }).from(schema.jobs).where(and(eq(schema.jobs.sourceId, job.id), eq(schema.jobs.orgId, orgId)));
  return { job, runs: runs.map((r) => ({ ...r, connected: agentRegistry.isOnline(r.deviceId) })), canaryOf: related, rollout: rollout ?? null };
});
