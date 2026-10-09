/**
 * Module registry. Every feature module exports `register(ctx)` which wires bus subscriptions and
 * background workers. Modules are listed here so boot order is explicit and modules stay decoupled.
 *
 * Feature modules add themselves to MODULES (one line each) - see lib/modules/<name>/index.ts.
 */
import { createLogger } from "../logger";

const log = createLogger("modules");

export interface ModuleContext {
  /** False in one-off CLI contexts where long-running workers must not start. */
  withServices: boolean;
}
export interface FeatureModule {
  name: string;
  register(ctx: ModuleContext): Promise<void> | void;
}

const MODULES: (() => Promise<{ default: FeatureModule }>)[] = [
  () => import("../modules/jobs"),
  () => import("../modules/monitoring"),
  () => import("../modules/patching"),
  () => import("../modules/remote"),
  () => import("../modules/automation"),
  () => import("../modules/policies"),
  () => import("../modules/notifications"),
  () => import("../modules/tickets"),
  () => import("../modules/health"),
  () => import("../modules/retention"),
  () => import("../modules/network"),
  () => import("../modules/ai"),
  () => import("../modules/integrations"),
  () => import("../modules/reports"),
];

export async function registerModules(ctx: ModuleContext) {
  for (const load of MODULES) {
    let mod: FeatureModule | null = null;
    try {
      mod = (await load()).default;
    } catch (err) {
      // A module that is not implemented yet must not stop the server.
      log.warn("module not loaded", { err: String((err as Error).message || err).split("\n")[0] });
      continue;
    }
    try {
      await mod.register(ctx);
      log.debug(`module ready: ${mod.name}`);
    } catch (err) {
      log.error(`module ${mod.name} failed to register`, { err: String((err as Error).stack || err) });
    }
  }
}
