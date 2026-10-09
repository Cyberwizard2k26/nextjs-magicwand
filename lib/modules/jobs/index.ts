import type { FeatureModule } from "@/lib/services/registry";
import { bus } from "@/lib/bus";
import { approveJob, cancelJob, completeRun, dispatchQueuedForDevice, tickJobs } from "@/lib/services/jobs";
import { getDb, schema } from "@/lib/db";
import { and, eq } from "drizzle-orm";
import { sweepStaleDevices } from "@/lib/services/devices";
import { isLeader } from "@/lib/boot";
import { createLogger } from "@/lib/logger";
import type { CommandResult } from "@/lib/protocol/agent";

const log = createLogger("jobs");

const mod: FeatureModule = {
  name: "jobs",
  register({ withServices }) {
    bus.subscribe<{ deviceId: string }>("agent.connected", (ev) => dispatchQueuedForDevice(ev.payload.deviceId));
    bus.subscribe<{ deviceId: string; result: CommandResult }>("agent.result.orphan", (ev) => completeRun(ev.payload.result.id, ev.payload.result));
    // Canary rollouts: when the canary wave finishes clean, promote the waiting rollout wave; when it fails, cancel it.
    const onCanaryDone = async (ev: { payload: { jobId: string; status?: string; stats?: { failed: number; succeeded: number } } }) => {
      const db = await getDb();
      const [rollout] = await db.select().from(schema.jobs).where(and(eq(schema.jobs.sourceId, ev.payload.jobId), eq(schema.jobs.status, "awaiting_approval")));
      if (!rollout || (rollout.payload as { canaryOf?: string }).canaryOf !== ev.payload.jobId) return;
      const clean = ev.payload.status === "completed" && (ev.payload.stats?.failed ?? 0) === 0 && (ev.payload.stats?.succeeded ?? 0) > 0;
      if (clean && (rollout.payload as { autoPromote?: boolean }).autoPromote) {
        log.info("canary clean, promoting rollout", { canary: ev.payload.jobId, rollout: rollout.id });
        await approveJob(rollout.id, "canary");
        bus.publish("job.rollout.promoted", { jobId: rollout.id, canaryJobId: ev.payload.jobId, name: rollout.name }, { orgId: rollout.orgId });
      } else if (!clean) {
        log.warn("canary not clean, holding rollout", { canary: ev.payload.jobId, rollout: rollout.id, status: ev.payload.status });
        if (ev.payload.status === "failed" || ev.payload.status === "cancelled") await cancelJob(rollout.id, "canary failed");
        bus.publish("job.rollout.held", { jobId: rollout.id, canaryJobId: ev.payload.jobId, name: rollout.name, canaryStatus: ev.payload.status }, { orgId: rollout.orgId });
      }
    };
    bus.subscribe("job.completed", onCanaryDone);
    bus.subscribe("job.failed", onCanaryDone);
    bus.subscribe("job.cancelled", (ev) => onCanaryDone({ payload: { ...(ev.payload as { jobId: string }), status: "cancelled" } }));
    if (!withServices) return;
    setInterval(async () => {
      try {
        if (!(await isLeader())) return;
        await tickJobs();
        await sweepStaleDevices();
      } catch (err) {
        log.error("tick failed", { err: String(err) });
      }
    }, 15_000).unref();
  },
};
export default mod;
