import type { FeatureModule } from "@/lib/services/registry";

/** reports module - bus subscriptions and background workers are registered here. */
const mod: FeatureModule = {
  name: "reports",
  register() {
    /* implemented by the reports module */
  },
};
export default mod;
