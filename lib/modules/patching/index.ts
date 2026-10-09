import type { FeatureModule } from "@/lib/services/registry";

/** patching module - bus subscriptions and background workers are registered here. */
const mod: FeatureModule = {
  name: "patching",
  register() {
    /* implemented by the patching module */
  },
};
export default mod;
