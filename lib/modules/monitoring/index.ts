import type { FeatureModule } from "@/lib/services/registry";
import { isLeader } from "@/lib/boot";
import { unsnoozeExpired } from "@/lib/services/alerts";
import { createLogger } from "@/lib/logger";

const log = createLogger("monitoring");

/** monitoring module - alert housekeeping (snooze expiry). Monitor evaluation lands here as it is built out. */
const mod: FeatureModule = {
  name: "monitoring",
  register({ withServices }) {
    if (!withServices) return;
    setInterval(async () => {
      try {
        if (!(await isLeader())) return;
        const n = await unsnoozeExpired();
        if (n) log.info("reopened snoozed alerts", { n });
      } catch (err) {
        log.error("tick failed", { err: String(err) });
      }
    }, 60_000).unref();
  },
};
export default mod;
