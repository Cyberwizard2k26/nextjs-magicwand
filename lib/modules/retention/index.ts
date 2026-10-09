import type { FeatureModule } from "@/lib/services/registry";

/** retention module - bus subscriptions and background workers are registered here. */
const mod: FeatureModule = {
  name: "retention",
  register() {
    /* implemented by the retention module */
  },
};
export default mod;
