import type { FeatureModule } from "@/lib/services/registry";

/** notifications module - bus subscriptions and background workers are registered here. */
const mod: FeatureModule = {
  name: "notifications",
  register() {
    /* implemented by the notifications module */
  },
};
export default mod;
