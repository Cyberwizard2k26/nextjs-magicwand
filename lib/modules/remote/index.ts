import type { FeatureModule } from "@/lib/services/registry";

/** remote module - bus subscriptions and background workers are registered here. */
const mod: FeatureModule = {
  name: "remote",
  register() {
    /* implemented by the remote module */
  },
};
export default mod;
