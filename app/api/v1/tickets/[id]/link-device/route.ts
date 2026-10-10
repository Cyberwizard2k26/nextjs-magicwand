import { api, errors } from "@/lib/api/route";
import { LinkDevice } from "@/lib/api/contracts/tickets";
import { getTicket, updateTicket } from "@/lib/services/tickets";
import { requireDevice, siteScope } from "@/lib/services/device-access";
import { actorOf, desk } from "../../_shared";

export const dynamic = "force-dynamic";

/** Link a device to the ticket (replaces any existing link). */
export const POST = api({ permission: "tickets.manage", body: LinkDevice }, async ({ orgId, params, body, principal, audit }) => {
  if (!(await getTicket(params.id, orgId, siteScope(principal, orgId)))) throw errors.notFound("Ticket not found");
  const device = await requireDevice(principal, orgId, body.deviceId);
  const { ticket } = await desk(() => updateTicket(orgId, params.id, { deviceId: device.id }, actorOf(principal)));
  await audit("ticket.link_device", { type: "ticket", id: ticket.id, name: `#${ticket.number} ${ticket.title}` }, { deviceId: device.id, deviceName: device.name });
  return { ticket, device: { id: device.id, name: device.name, platform: device.platform, status: device.status } };
});

/** Remove the device link. */
export const DELETE = api({ permission: "tickets.manage" }, async ({ orgId, params, principal, audit }) => {
  if (!(await getTicket(params.id, orgId, siteScope(principal, orgId)))) throw errors.notFound("Ticket not found");
  const { ticket } = await desk(() => updateTicket(orgId, params.id, { deviceId: null }, actorOf(principal)));
  await audit("ticket.unlink_device", { type: "ticket", id: ticket.id, name: `#${ticket.number} ${ticket.title}` });
  return { ticket };
});
