/**
 * Device-level access checks shared by every /devices/[id]/* route: the device must belong to the active
 * org AND, for memberships scoped to sites, to one of the caller's sites.
 */
import { errors } from "../api/route";
import type { Principal } from "../auth/session";
import { getDeviceInOrg, type Device } from "./devices";

export function deviceVisibleTo(principal: Principal, device: Pick<Device, "orgId" | "siteId">): boolean {
  if (principal.isSuperAdmin) return true;
  const m = principal.memberships.find((x) => x.orgId === device.orgId);
  if (!m) return false;
  if (m.siteIds.length && (!device.siteId || !m.siteIds.includes(device.siteId))) return false;
  return true;
}

/** Load a device the principal may see, or throw 404 (no existence leak across sites/orgs). */
export async function requireDevice(principal: Principal, orgId: string, deviceId: string): Promise<Device> {
  const device = await getDeviceInOrg(deviceId, orgId);
  if (!device || !deviceVisibleTo(principal, device)) throw errors.notFound("Device not found");
  return device;
}

/** Site ids that scope the principal's view of an org (undefined = whole org). */
export function siteScope(principal: Principal, orgId: string): string[] | undefined {
  if (principal.isSuperAdmin) return undefined;
  const m = principal.memberships.find((x) => x.orgId === orgId);
  return m?.siteIds?.length ? m.siteIds : undefined;
}
