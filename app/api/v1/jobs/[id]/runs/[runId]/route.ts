import { and, eq } from "drizzle-orm";
import { api, errors } from "@/lib/api/route";
import { getDb, schema } from "@/lib/db";

export const dynamic = "force-dynamic";

/** Full output of one run (stdout/stderr/structured output). */
export const GET = api({ permission: "jobs.view" }, async ({ orgId, params }) => {
  const db = await getDb();
  const [run] = await db.select().from(schema.jobRuns).where(and(eq(schema.jobRuns.id, params.runId), eq(schema.jobRuns.jobId, params.id), eq(schema.jobRuns.orgId, orgId)));
  if (!run) throw errors.notFound("Run not found");
  const [device] = await db.select({ id: schema.devices.id, name: schema.devices.name, platform: schema.devices.platform }).from(schema.devices).where(eq(schema.devices.id, run.deviceId));
  return { run, device: device ?? null };
});
