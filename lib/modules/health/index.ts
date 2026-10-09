import type { FeatureModule } from "@/lib/services/registry";

/** health module - bus subscriptions and background workers are registered here. */
const mod: FeatureModule = {
  name: "health",
  register() {
    /* implemented by the health module */
  },
};
export default mod;
