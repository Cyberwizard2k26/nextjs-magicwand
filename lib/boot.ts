/**
 * One-time server bootstrap: secret, database, seed data, realtime registries, background services.
 * Called by the custom server before accepting traffic. Safe to call more than once.
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { eq, inArray, and, isNull } from "drizzle-orm";
import { config } from "./config";
import { getDb, schema } from "./db";
import { setMasterSecret, randomToken, hashPassword } from "./util/crypto";
import { bus, NODE_ID } from "./bus";
import { agentRegistry } from "./realtime/agent-registry";
import { clientHub } from "./realtime/client-hub";
import { SYSTEM_ROLES } from "./rbac/permissions";
import { createLogger } from "./logger";
import { SERVER_VERSION } from "./version";
import { registerModules } from "./services/registry";

const log = createLogger("boot");

interface BootGlobal { __mwBooted?: Promise<void> }
const g = globalThis as unknown as BootGlobal;

function loadOrCreateSecret(): string {
  if (config.secret) return config.secret;
  fs.mkdirSync(config.dataDir, { recursive: true });
  const file = path.join(config.dataDir, "secret.key");
  if (fs.existsSync(file)) return fs.readFileSync(file, "utf8").trim();
  const secret = randomToken(48);
  fs.writeFileSync(file, secret, { mode: 0o600 });
  log.warn(`APP_SECRET not set - generated one at ${file}. Set APP_SECRET in production so it survives redeploys.`);
  return secret;
}

export async function ensureSystemRoles() {
  const db = await getDb();
  const existing = await db.select().from(schema.roles).where(isNull(schema.roles.orgId));
  const byName = new Map(existing.map((r) => [r.name, r]));
  for (const r of SYSTEM_ROLES) {
    const row = byName.get(r.name);
    if (!row) await db.insert(schema.roles).values({ orgId: null, name: r.name, description: r.description, permissions: r.permissions, isSystem: true });
    else if (JSON.stringify(row.permissions) !== JSON.stringify(r.permissions)) await db.update(schema.roles).set({ permissions: r.permissions, description: r.description }).where(eq(schema.roles.id, row.id));
  }
}

export async function systemRoleId(key: string): Promise<string> {
  const db = await getDb();
  const def = SYSTEM_ROLES.find((r) => r.key === key) ?? SYSTEM_ROLES[0];
  const [row] = await db.select().from(schema.roles).where(and(isNull(schema.roles.orgId), eq(schema.roles.name, def.name)));
  if (!row) throw new Error(`system role ${key} missing`);
  return row.id;
}

export function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48) || "org";
}

/** Create an organization with its first owner. Used by the setup wizard, env bootstrap and the orgs API. */
export async function createOrganization(opts: { name: string; kind?: "msp" | "client" | "internal"; parentId?: string | null; ownerUserId?: string }) {
  const db = await getDb();
  let slug = slugify(opts.name);
  const taken = await db.select({ slug: schema.organizations.slug }).from(schema.organizations).where(eq(schema.organizations.slug, slug));
  if (taken.length) slug = `${slug}-${randomToken(3).toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 4)}`;
  const [org] = await db.insert(schema.organizations).values({ name: opts.name, slug, kind: opts.kind ?? "client", parentId: opts.parentId ?? null }).returning();
  await db.insert(schema.sites).values({ orgId: org.id, name: "Main site" });
  await db.insert(schema.deviceGroups).values([
    { orgId: org.id, name: "Workstations", isDynamic: true, filter: { all: [{ field: "deviceType", op: "in", value: ["workstation", "laptop"] }] }, icon: "monitor" },
    { orgId: org.id, name: "Servers", isDynamic: true, filter: { all: [{ field: "deviceType", op: "in", value: ["server", "vm"] }] }, icon: "server" },
    { orgId: org.id, name: "Network devices", isDynamic: true, filter: { all: [{ field: "deviceType", op: "in", value: ["network", "printer"] }] }, icon: "network" },
  ]);
  if (opts.ownerUserId) await db.insert(schema.memberships).values({ userId: opts.ownerUserId, orgId: org.id, roleId: await systemRoleId("owner"), isDefault: true });
  bus.publish("org.created", { orgId: org.id, name: org.name }, { orgId: org.id });
  return org;
}

export async function hasAnyUser(): Promise<boolean> {
  const db = await getDb();
  const rows = await db.select({ id: schema.users.id }).from(schema.users).limit(1);
  return rows.length > 0;
}

async function bootstrapAdminFromEnv() {
  const { adminEmail, adminPassword, orgName } = config.bootstrap;
  if (!adminEmail || !adminPassword) return;
  if (await hasAnyUser()) return;
  const db = await getDb();
  const [user] = await db.insert(schema.users).values({ email: adminEmail.toLowerCase(), name: adminEmail.split("@")[0], passwordHash: await hashPassword(adminPassword), isSuperAdmin: true }).returning();
  await createOrganization({ name: orgName || "My Organization", kind: "msp", ownerUserId: user.id });
  log.info(`bootstrapped super admin ${adminEmail} from environment`);
}

async function registerNode() {
  const db = await getDb();
  const row = { id: NODE_ID, hostname: os.hostname(), version: SERVER_VERSION, startedAt: new Date(), lastHeartbeatAt: new Date(), agentConnections: 0, userConnections: 0 };
  await db.insert(schema.serverNodes).values(row).onConflictDoUpdate({ target: schema.serverNodes.id, set: { lastHeartbeatAt: new Date(), startedAt: new Date(), version: SERVER_VERSION } });
  setInterval(async () => {
    try {
      await db.update(schema.serverNodes).set({ lastHeartbeatAt: new Date(), agentConnections: agentRegistry.localCount(), userConnections: clientHub.count() }).where(eq(schema.serverNodes.id, NODE_ID));
      // prune dead nodes (no heartbeat for 2 minutes)
      const nodes = await db.select().from(schema.serverNodes);
      const dead = nodes.filter((n) => Date.now() - n.lastHeartbeatAt.getTime() > 120_000).map((n) => n.id);
      if (dead.length) await db.delete(schema.serverNodes).where(inArray(schema.serverNodes.id, dead));
    } catch (err) {
      log.debug("node heartbeat failed", { err: String(err) });
    }
  }, 30_000).unref();
}

/** True on exactly one node: the one with the lexicographically smallest live id. Used to run singleton schedulers. */
export async function isLeader(): Promise<boolean> {
  const db = await getDb();
  const nodes = await db.select({ id: schema.serverNodes.id, hb: schema.serverNodes.lastHeartbeatAt }).from(schema.serverNodes);
  const live = nodes.filter((n) => Date.now() - n.hb.getTime() < 120_000).map((n) => n.id).sort();
  return live.length === 0 || live[0] === NODE_ID;
}

export function boot(opts: { withServices?: boolean } = {}): Promise<void> {
  if (g.__mwBooted) return g.__mwBooted;
  g.__mwBooted = (async () => {
    setMasterSecret(loadOrCreateSecret());
    fs.mkdirSync(config.dataDir, { recursive: true });
    await getDb();
    await ensureSystemRoles();
    await bootstrapAdminFromEnv();
    await bus.init();
    agentRegistry.init();
    clientHub.init();
    await registerNode();
    await registerModules({ withServices: opts.withServices ?? true });
    log.info(`MagicWand RMM ${SERVER_VERSION} ready`, { node: NODE_ID, publicUrl: config.publicUrl, env: config.env });
  })().catch((err) => {
    g.__mwBooted = undefined;
    throw err;
  });
  return g.__mwBooted;
}
