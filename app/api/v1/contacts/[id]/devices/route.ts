import { api, errors } from "@/lib/api/route";
import { ContactDeviceLink, ContactDeviceUnlink } from "@/lib/api/contracts/contacts";
import { getContact, linkContactDevice, unlinkContactDevice } from "@/lib/services/contacts";
import { requireDevice, siteScope } from "@/lib/services/device-access";
import { actorOf, desk } from "../../../tickets/_shared";

export const dynamic = "force-dynamic";

/** Devices linked to the contact. */
export const GET = api({ permission: "tickets.view" }, async ({ orgId, params, principal }) => {
  const detail = await getContact(params.id, orgId, siteScope(principal, orgId));
  if (!detail) throw errors.notFound("Contact not found");
  return { items: detail.devices, total: detail.devices.length };
});

/** Link a device to the contact (`isPrimary` marks the machine they usually work on). */
export const POST = api({ permission: "contacts.manage", body: ContactDeviceLink }, async ({ orgId, params, body, principal, audit }) => {
  if (!(await getContact(params.id, orgId, siteScope(principal, orgId)))) throw errors.notFound("Contact not found");
  const device = await requireDevice(principal, orgId, body.deviceId);
  const link = await desk(() => linkContactDevice(orgId, params.id, device.id, body.isPrimary, actorOf(principal)));
  await audit("contact.device.link", { type: "contact", id: params.id }, { deviceId: device.id, deviceName: device.name, isPrimary: link.isPrimary });
  return { link };
});

/** Unlink a device from the contact. */
export const DELETE = api({ permission: "contacts.manage", body: ContactDeviceUnlink }, async ({ orgId, params, body, principal, audit }) => {
  if (!(await getContact(params.id, orgId, siteScope(principal, orgId)))) throw errors.notFound("Contact not found");
  await desk(() => unlinkContactDevice(orgId, params.id, body.deviceId, actorOf(principal)));
  await audit("contact.device.unlink", { type: "contact", id: params.id }, { deviceId: body.deviceId });
  return { ok: true };
});
