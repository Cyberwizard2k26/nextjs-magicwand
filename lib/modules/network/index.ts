import type { FeatureModule } from "@/lib/services/registry";

/** network module - bus subscriptions and background workers are registered here. */
const mod: FeatureModule = {
  name: "network",
  register() {
    /* implemented by the network module */
  },
};
export default mod;
