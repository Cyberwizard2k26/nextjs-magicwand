import type { FeatureModule } from "@/lib/services/registry";

/** integrations module - bus subscriptions and background workers are registered here. */
const mod: FeatureModule = {
  name: "integrations",
  register() {
    /* implemented by the integrations module */
  },
};
export default mod;
