/**
 * Integrations module: outbound webhook delivery. Every bus event scoped to an organization is matched against that
 * org's enabled webhooks, recorded in webhook_deliveries and POSTed with an HMAC signature; failures retry with backoff
 * on the leader node only. Old deliveries are pruned nightly.
 */
import type { FeatureModule } from "@/lib/services/registry";
import { bus, NODE_ID } from "@/lib/bus";
import { isLeader } from "@/lib/boot";
import { createLogger } from "@/lib/logger";
import { enqueueEvent, processRetries, purgeOldDeliveries } from "@/lib/services/webhooks";

const log = createLogger("integrations");

const mod: FeatureModule = {
  name: "integrations",
  register(ctx) {
    if (!ctx.withServices) return;
    bus.subscribe("*", async (ev) => {
      // Deliveries are only created on the node that published the event (events fanned out via Redis carry another node id).
      if (ev.node && ev.node !== NODE_ID) return;
      try { await enqueueEvent(ev); } catch (err) { log.error("enqueue failed", { event: ev.name, err: String(err) }); }
    });
    const retry = setInterval(async () => {
      try {
        if (!(await isLeader())) return;
        const n = await processRetries();
        if (n) log.debug(`retried ${n} webhook deliveries`);
      } catch (err) { log.error("retry loop failed", { err: String(err) }); }
    }, 30_000);
    retry.unref();
    const purge = setInterval(async () => {
      try { if (await isLeader()) { const n = await purgeOldDeliveries(30); if (n) log.info(`pruned ${n} webhook deliveries older than 30 days`); } } catch (err) { log.error("purge failed", { err: String(err) }); }
    }, 6 * 3600_000);
    purge.unref();
    log.debug("webhook delivery worker ready");
  },
};
export default mod;
