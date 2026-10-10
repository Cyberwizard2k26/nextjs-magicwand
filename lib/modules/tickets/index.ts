import type { FeatureModule } from "@/lib/services/registry";
import { isLeader } from "@/lib/boot";
import { sweepSlaBreaches } from "@/lib/services/tickets";
import { createLogger } from "@/lib/logger";

const log = createLogger("tickets");

/**
 * Tickets module: SLA housekeeping. Every minute the leader node flags tickets whose first-response or
 * resolution target has passed (`tickets.slaBreached`), writes a system event on the ticket and publishes
 * `ticket.sla_breached` so dashboards, notifications and the AI copilot can react.
 */
const mod: FeatureModule = {
  name: "tickets",
  register({ withServices }) {
    if (!withServices) return;
    const tick = async () => {
      try {
        if (!(await isLeader())) return;
        const n = await sweepSlaBreaches();
        if (n) log.info("tickets breached SLA", { n });
      } catch (err) {
        log.error("sla sweep failed", { err: String(err) });
      }
    };
    setTimeout(tick, 15_000).unref();
    setInterval(tick, 60_000).unref();
  },
};
export default mod;
