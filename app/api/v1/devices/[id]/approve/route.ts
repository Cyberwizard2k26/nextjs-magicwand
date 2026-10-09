import { eq } from "drizzle-orm";
import { api, errors } from "@/lib/api/route";
import { getDb, schema } from "@/lib/db";
import { bus } from "@/lib/bus";
import { requireDevice } from "@/lib/services/device-access";
import { addDeviceEvent } from "@/lib/services/devices";
import { agentRegistry } from "@/lib/realtime/agent-registry";

export const dynamic = "force-dynamic";

/** Approve a device enrolled with a "require approval" token so it becomes managed. */
export const POST = api({ permission: "devices.approve" }, async ({ orgId, params, principal, audit }) => {
  const device = await requireDevice(principal, orgId, params.id);
  if (device.status !== "pending") throw errors.conflict("Device is not awaiting approval");
  const db = await getDb();
  const status = agentRegistry.isOnline(device.id) ? "online" : "offline";
  const [updated] = await db.update(schema.devices).set({ status, approvedBy: principal.user?.id ?? null, lastSeenAt: status === "online" ? new Date() : device.lastSeenAt }).where(eq(schema.devices.id, device.id)).returning();
  await addDeviceEvent(device.id, orgId, { type: "device.approved", message: `Approved by ${principal.user?.name ?? principal.user?.email ?? "an administrator"}`, source: "user", actorId: principal.user?.id ?? undefined });
  bus.publish("device.approved", { deviceId: device.id, name: device.name, status }, { orgId, deviceId: device.id });
  if (status === "online") bus.publish("device.online", { deviceId: device.id, name: device.name }, { orgId, deviceId: device.id });
  await audit("device.approved", { type: "device", id: device.id, name: device.name });
  return { device: updated };
});
