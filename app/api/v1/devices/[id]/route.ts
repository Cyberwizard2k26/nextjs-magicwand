import { z } from "zod";
import { eq } from "drizzle-orm";
import { api, errors } from "@/lib/api/route";
import { getDb, schema } from "@/lib/db";
import { getDeviceInOrg } from "@/lib/services/devices";
import { agentRegistry } from "@/lib/realtime/agent-registry";

export const dynamic = "force-dynamic";

export const GET = api({ permission: "devices.view" }, async ({ orgId, params }) => {
  const device = await getDeviceInOrg(params.id, orgId);
  if (!device) throw errors.notFound("Device not found");
  const db = await getDb();
  const [hardware] = await db.select().from(schema.deviceHardware).where(eq(schema.deviceHardware.deviceId, device.id));
  const [security] = await db.select().from(schema.deviceSecurity).where(eq(schema.deviceSecurity.deviceId, device.id));
  const site = device.siteId ? (await db.select().from(schema.sites).where(eq(schema.sites.id, device.siteId)))[0] : null;
  const group = device.groupId ? (await db.select().from(schema.deviceGroups).where(eq(schema.deviceGroups.id, device.groupId)))[0] : null;
  return { device: { ...device, connected: agentRegistry.isOnline(device.id) }, hardware: hardware ?? null, security: security ?? null, site, group };
});

const Patch = z.object({
  displayName: z.string().max(120).nullable().optional(),
  description: z.string().max(2000).nullable().optional(),
  siteId: z.string().nullable().optional(),
  groupId: z.string().nullable().optional(),
  tags: z.array(z.string().max(64)).max(50).optional(),
  customFields: z.record(z.string(), z.unknown()).optional(),
  deviceType: z.enum(["workstation", "laptop", "server", "vm", "network", "printer", "mobile", "iot", "other"]).optional(),
  notes: z.string().max(20000).nullable().optional(),
  isProbe: z.boolean().optional(),
  status: z.enum(["maintenance", "offline", "online"]).optional(),
  location: z.object({ lat: z.number(), lng: z.number(), source: z.literal("manual") }).nullable().optional(),
});

export const PATCH = api({ permission: "devices.manage", body: Patch }, async ({ orgId, params, body, audit }) => {
  const device = await getDeviceInOrg(params.id, orgId);
  if (!device) throw errors.notFound("Device not found");
  const db = await getDb();
  const patch: Record<string, unknown> = { ...body };
  if (body.displayName !== undefined) patch.name = body.displayName || device.hostname || device.name;
  const [updated] = await db.update(schema.devices).set(patch).where(eq(schema.devices.id, device.id)).returning();
  await audit("device.updated", { type: "device", id: device.id, name: device.name }, { fields: Object.keys(body) });
  return { device: updated };
});

export const DELETE = api({ permission: "devices.delete" }, async ({ orgId, params, audit }) => {
  const device = await getDeviceInOrg(params.id, orgId);
  if (!device) throw errors.notFound("Device not found");
  const db = await getDb();
  if (agentRegistry.isLocal(device.id)) agentRegistry.command(device.id, "agent_uninstall", {}, { timeoutSeconds: 10 }).catch(() => {});
  await db.delete(schema.devices).where(eq(schema.devices.id, device.id));
  await audit("device.deleted", { type: "device", id: device.id, name: device.name });
  return { ok: true };
});
