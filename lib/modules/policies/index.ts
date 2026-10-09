import type { FeatureModule } from "@/lib/services/registry";

/** policies module - bus subscriptions and background workers are registered here. */
const mod: FeatureModule = {
  name: "policies",
  register() {
    /* implemented by the policies module */
  },
};
export default mod;
