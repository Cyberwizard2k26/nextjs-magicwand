import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { requireUser } from "@/lib/auth/server";
import { principalPermissions } from "@/lib/auth/session";
import { getDb, schema } from "@/lib/db";
import { requireDevice } from "@/lib/services/device-access";
import { agentRegistry } from "@/lib/realtime/agent-registry";
import { DeviceProvider, type DeviceDetail } from "@/components/devices/device-context";
import { DeviceHeader } from "@/components/devices/device-header";

export const dynamic = "force-dynamic";

export default async function DeviceLayout({ params, children }: { params: Promise<{ id: string }>; children: React.ReactNode }) {
  const { id } = await params;
  const p = await requireUser(`/devices/${id}`);
  if (!p.activeOrgId) notFound();
  let device;
  try {
    device = await requireDevice(p, p.activeOrgId, id);
  } catch {
    notFound();
  }
  const db = await getDb();
  const [hardware] = await db.select().from(schema.deviceHardware).where(eq(schema.deviceHardware.deviceId, device.id));
  const [security] = await db.select().from(schema.deviceSecurity).where(eq(schema.deviceSecurity.deviceId, device.id));
  const site = device.siteId ? (await db.select({ id: schema.sites.id, name: schema.sites.name }).from(schema.sites).where(eq(schema.sites.id, device.siteId)))[0] ?? null : null;
  const group = device.groupId ? (await db.select({ id: schema.deviceGroups.id, name: schema.deviceGroups.name }).from(schema.deviceGroups).where(eq(schema.deviceGroups.id, device.groupId)))[0] ?? null : null;
  const conn = agentRegistry.get(device.id);
  // Serialize dates for the client boundary.
  const initial = JSON.parse(JSON.stringify({ device: { ...device, connected: agentRegistry.isOnline(device.id), capabilities: conn?.hello.capabilities ?? [] }, hardware: hardware ?? null, security: security ?? null, site, group })) as DeviceDetail;
  return (
    <DeviceProvider initial={initial} permissions={principalPermissions(p, p.activeOrgId)}>
      <DeviceHeader />
      {children}
    </DeviceProvider>
  );
}
