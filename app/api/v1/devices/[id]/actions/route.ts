import { z } from "zod";
import { api, errors } from "@/lib/api/route";
import { can } from "@/lib/auth/session";
import type { Permission } from "@/lib/rbac/permissions";
import { requireDevice } from "@/lib/services/device-access";
import { createJob } from "@/lib/services/jobs";
import type { JobType } from "@/lib/db/schema/automation";
import { getDb, schema } from "@/lib/db";
import { and, eq, ne, sql } from "drizzle-orm";
import { agentRegistry } from "@/lib/realtime/agent-registry";

export const dynamic = "force-dynamic";

/**
 * Single-device actions. Each one becomes a job (durable, audited, replayable) targeting just this device,
 * so the console history, the timeline and the jobs page all agree on what was done and by whom.
 */
const ACTIONS: Record<string, { type: JobType; permission: Permission; name: (p: Record<string, unknown>) => string; timeoutSeconds?: number }> = {
  command: { type: "command", permission: "scripts.run", name: (p) => `Console: ${String(p.command ?? "").slice(0, 80)}`, timeoutSeconds: 600 },
  script: { type: "script", permission: "scripts.run", name: (p) => `Script: ${String(p.name ?? p.scriptId ?? "ad-hoc")}` },
  reboot: { type: "reboot", permission: "devices.power", name: () => "Reboot" },
  shutdown: { type: "shutdown", permission: "devices.power", name: () => "Shut down" },
  lock_screen: { type: "lock_screen", permission: "devices.power", name: () => "Lock screen" },
  logoff_user: { type: "logoff_user", permission: "devices.power", name: () => "Log off user" },
  inventory: { type: "inventory", permission: "devices.manage", name: () => "Refresh inventory" },
  message_user: { type: "message_user", permission: "remote.tools", name: (p) => `Message: ${String(p.title ?? "").slice(0, 60)}` },
  clear_cache: { type: "clear_cache", permission: "scripts.run", name: () => "Clear temporary files" },
  agent_update: { type: "agent_update", permission: "devices.manage", name: () => "Update agent" },
  patch_scan: { type: "patch_scan", permission: "patches.view", name: () => "Patch scan", timeoutSeconds: 1800 },
  patch_install: { type: "patch_install", permission: "patches.manage", name: (p) => (p.all ? "Install all updates" : `Install ${(p.externalIds as string[] | undefined)?.length ?? 0} update(s)`), timeoutSeconds: 3 * 3600 },
  software_install: { type: "software_install", permission: "software.manage", name: (p) => `Install ${String(p.package ?? p.url ?? "software")}`, timeoutSeconds: 1800 },
  software_uninstall: { type: "software_uninstall", permission: "software.manage", name: (p) => `Uninstall ${String(p.name ?? p.package ?? "software")}`, timeoutSeconds: 1800 },
};

const Body = z.object({
  action: z.string(),
  payload: z.record(z.string(), z.unknown()).default({}),
  timeoutSeconds: z.number().int().positive().max(24 * 3600).optional(),
  /** Queue for later if the device is offline right now (default true, matching jobs). */
  runWhenOnline: z.boolean().optional(),
});

export const POST = api({ permission: "devices.view", body: Body }, async ({ orgId, params, body, principal, audit }) => {
  if (body.action === "wake_on_lan") return wakeOnLan(orgId, params.id, principal, audit);
  const spec = ACTIONS[body.action];
  if (!spec) throw errors.badRequest(`Unknown action. Allowed: ${Object.keys(ACTIONS).join(", ")}`);
  if (!can(principal, spec.permission, orgId)) throw errors.forbidden(`This action requires the "${spec.permission}" permission`);
  if (body.action === "command" && !String(body.payload.command ?? "").trim()) throw errors.badRequest("command is required");
  const device = await requireDevice(principal, orgId, params.id);
  const { job, runs } = await createJob({
    orgId,
    type: spec.type,
    name: spec.name(body.payload),
    targetType: "device",
    targetIds: [device.id],
    payload: body.payload,
    source: "manual",
    timeoutSeconds: body.timeoutSeconds ?? spec.timeoutSeconds,
    runWhenOnline: body.runWhenOnline ?? true,
    createdBy: principal.user?.id ?? null,
    createdByName: principal.user?.name ?? principal.user?.email ?? principal.apiKey?.name ?? null,
  });
  await audit(`device.action.${body.action}`, { type: "device", id: device.id, name: device.name }, { jobId: job.id, payload: body.action === "command" ? { command: body.payload.command } : body.payload });
  return { job, run: runs[0] ?? null };
});

/**
 * Wake-on-LAN: the magic packet has to come from the target's own LAN, so it is sent by another online
 * device in the same site (same /24 as one of the target's addresses when possible).
 */
async function wakeOnLan(orgId: string, deviceId: string, principal: Parameters<typeof requireDevice>[0], audit: (action: string, target?: { type?: string; id?: string; name?: string }, details?: Record<string, unknown>) => Promise<void>) {
  if (!can(principal, "devices.power", orgId)) throw errors.forbidden('This action requires the "devices.power" permission');
  const device = await requireDevice(principal, orgId, deviceId);
  const mac = device.macAddresses.find((m) => /^([0-9a-f]{2}[:-]){5}[0-9a-f]{2}$/i.test(m) && !/^00[:-]00[:-]00/.test(m));
  if (!mac) throw errors.badRequest("No usable MAC address is recorded for this device yet (it is collected with the inventory)");
  const db = await getDb();
  const candidates = await db.select({ id: schema.devices.id, name: schema.devices.name, localIps: schema.devices.localIps, siteId: schema.devices.siteId }).from(schema.devices).where(and(eq(schema.devices.orgId, orgId), ne(schema.devices.id, device.id), eq(schema.devices.status, "online"), device.siteId ? eq(schema.devices.siteId, device.siteId) : sql`true`));
  const online = candidates.filter((c) => agentRegistry.isOnline(c.id));
  const subnet = (ip: string) => ip.split(".").slice(0, 3).join(".");
  const targetNets = new Set(device.localIps.filter((ip) => ip.includes(".")).map(subnet));
  const peer = online.find((c) => c.localIps.some((ip) => targetNets.has(subnet(ip)))) ?? online[0];
  if (!peer) throw errors.conflict("No online device in the same site can send the wake packet");
  const broadcast = peer.localIps.find((ip) => targetNets.has(subnet(ip)));
  const { job, runs } = await createJob({ orgId, type: "wake_on_lan", name: `Wake ${device.name} via ${peer.name}`, targetType: "device", targetIds: [peer.id], payload: { mac, broadcast: broadcast ? subnet(broadcast) + ".255" : "255.255.255.255", targetDeviceId: device.id }, source: "manual", timeoutSeconds: 60, runWhenOnline: false, createdBy: principal.user?.id ?? null, createdByName: principal.user?.name ?? principal.user?.email ?? null });
  await audit("device.action.wake_on_lan", { type: "device", id: device.id, name: device.name }, { jobId: job.id, via: peer.id, mac });
  return { job, run: runs[0] ?? null, via: { id: peer.id, name: peer.name } };
}
