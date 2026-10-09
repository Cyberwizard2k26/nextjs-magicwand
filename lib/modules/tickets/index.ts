import type { FeatureModule } from "@/lib/services/registry";

/** tickets module - bus subscriptions and background workers are registered here. */
const mod: FeatureModule = {
  name: "tickets",
  register() {
    /* implemented by the tickets module */
  },
};
export default mod;
