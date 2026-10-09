import type { FeatureModule } from "@/lib/services/registry";
import { bus } from "@/lib/bus";
import { completeRun, dispatchQueuedForDevice, tickJobs } from "@/lib/services/jobs";
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
