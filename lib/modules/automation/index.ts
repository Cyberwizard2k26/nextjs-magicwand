import type { FeatureModule } from "@/lib/services/registry";

/** automation module - bus subscriptions and background workers are registered here. */
const mod: FeatureModule = {
  name: "automation",
  register() {
    /* implemented by the automation module */
  },
};
export default mod;
