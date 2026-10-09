import { and, eq } from "drizzle-orm";
import { api, errors } from "@/lib/api/route";
import { getDb, schema } from "@/lib/db";
import { approveJob, cancelJob, dispatchJob } from "@/lib/services/jobs";

export const dynamic = "force-dynamic";

/** Job lifecycle actions: cancel | approve | retry (re-queues failed and timed-out runs). */
export const POST = api({ permission: "jobs.manage" }, async ({ orgId, params, principal, audit }) => {
  const db = await getDb();
  const [job] = await db.select().from(schema.jobs).where(and(eq(schema.jobs.id, params.id), eq(schema.jobs.orgId, orgId)));
  if (!job) throw errors.notFound("Job not found");
  switch (params.action) {
    case "cancel":
      if (!["queued", "awaiting_approval", "running"].includes(job.status)) throw errors.conflict(`Job is ${job.status}`);
      await cancelJob(job.id, `cancelled by ${principal.user?.name ?? principal.user?.email ?? "api"}`);
      break;
    case "approve":
      if (job.status !== "awaiting_approval") throw errors.conflict("Job is not awaiting approval");
      await approveJob(job.id, principal.user?.id ?? "api");
      break;
    case "retry": {
      if (!["completed", "partial", "failed", "cancelled"].includes(job.status)) throw errors.conflict(`Job is ${job.status}`);
      const res = await db.update(schema.jobRuns).set({ status: "pending", error: null, finishedAt: null, exitCode: null, attempt: 1 }).where(and(eq(schema.jobRuns.jobId, job.id), eq(schema.jobRuns.status, "failed"))).returning({ id: schema.jobRuns.id });
      const res2 = await db.update(schema.jobRuns).set({ status: "pending", error: null, finishedAt: null, exitCode: null, attempt: 1 }).where(and(eq(schema.jobRuns.jobId, job.id), eq(schema.jobRuns.status, "timeout"))).returning({ id: schema.jobRuns.id });
      if (!res.length && !res2.length) throw errors.conflict("No failed runs to retry");
      await db.update(schema.jobs).set({ status: "queued", completedAt: null, expiresAt: new Date(Date.now() + 7 * 86400_000) }).where(eq(schema.jobs.id, job.id));
      void dispatchJob(job.id);
      break;
    }
    default:
      throw errors.notFound("Unknown action");
  }
  await audit(`job.${params.action}`, { type: "job", id: job.id, name: job.name });
  const [updated] = await db.select().from(schema.jobs).where(eq(schema.jobs.id, job.id));
  return { job: updated };
});
