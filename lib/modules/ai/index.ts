import type { FeatureModule } from "@/lib/services/registry";

/** ai module - bus subscriptions and background workers are registered here. */
const mod: FeatureModule = {
  name: "ai",
  register() {
    /* implemented by the ai module */
  },
};
export default mod;
