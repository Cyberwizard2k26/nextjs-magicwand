import type { FeatureModule } from "@/lib/services/registry";

/** monitoring module - bus subscriptions and background workers are registered here. */
const mod: FeatureModule = {
  name: "monitoring",
  register() {
    /* implemented by the monitoring module */
  },
};
export default mod;
