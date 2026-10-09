import type { FeatureModule } from "@/lib/services/registry";
import { bus } from "@/lib/bus";
import { applyPatchInstallResult, applyPatchScan, type ScannedPatch } from "@/lib/services/patches";
import { createLogger } from "@/lib/logger";

const log = createLogger("patching");

/** patching module: turns patch_scan / patch_install job results (and inventory patch sections) into patch state. */
const mod: FeatureModule = {
  name: "patching",
  register() {
    bus.subscribe<{ jobId: string; deviceId: string; type: string; payload: Record<string, unknown>; output?: unknown }>("job.run.succeeded", async (ev) => {
      const { type, deviceId, output, jobId, payload } = ev.payload;
      if (!ev.orgId) return;
      try {
        if (type === "patch_scan") {
          const o = (output ?? {}) as { manager?: string; patches?: ScannedPatch[]; rebootPending?: boolean };
          const s = await applyPatchScan(deviceId, ev.orgId, o.manager ?? "other", o.patches ?? [], o.rebootPending);
          log.info("patch scan applied", s);
        } else if (type === "patch_install") {
          await applyPatchInstallResult(deviceId, ev.orgId, jobId, (output ?? {}) as Parameters<typeof applyPatchInstallResult>[3], { externalIds: payload.externalIds as string[] | undefined, all: payload.all as boolean | undefined });
        }
      } catch (err) {
        log.error("could not apply patch result", { err: String(err), jobId });
      }
    });
    bus.subscribe<{ jobId: string; deviceId: string; type: string; payload: Record<string, unknown>; stderr?: string }>("job.run.failed", async (ev) => {
      if (ev.payload.type !== "patch_install" || !ev.orgId) return;
      const ids = (ev.payload.payload.externalIds as string[] | undefined) ?? [];
      await applyPatchInstallResult(ev.payload.deviceId, ev.orgId, ev.payload.jobId, { failed: ids.map((id) => ({ id, code: "job failed" })) }, { externalIds: ids });
    });
    bus.subscribe<{ deviceId: string; patches: ScannedPatch[] }>("patches.scan", async (ev) => {
      if (!ev.orgId || !Array.isArray(ev.payload.patches)) return;
      await applyPatchScan(ev.payload.deviceId, ev.orgId, "inventory", ev.payload.patches);
    });
  },
};
export default mod;
