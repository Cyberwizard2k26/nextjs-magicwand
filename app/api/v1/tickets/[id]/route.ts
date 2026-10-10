import { api, errors } from "@/lib/api/route";
import { TicketUpdate } from "@/lib/api/contracts/tickets";
import { deleteTicket, getTicket, updateTicket } from "@/lib/services/tickets";
import { requireDevice, siteScope } from "@/lib/services/device-access";
import { actorOf, desk } from "../_shared";

export const dynamic = "force-dynamic";

/** Ticket detail: ticket, conversation, time entries, linked device / contact / assignee / alert, related tickets. */
export const GET = api({ permission: "tickets.view" }, async ({ orgId, params, principal }) => {
  const detail = await getTicket(params.id, orgId, siteScope(principal, orgId));
  if (!detail) throw errors.notFound("Ticket not found");
  return detail;
});

/** Update any ticket field, including status transitions and assignment. */
export const PATCH = api({ permission: "tickets.manage", body: TicketUpdate }, async ({ orgId, params, body, principal, audit }) => {
  if (!(await getTicket(params.id, orgId, siteScope(principal, orgId)))) throw errors.notFound("Ticket not found");
  if (body.deviceId) await requireDevice(principal, orgId, body.deviceId);
  const { ticket, changes } = await desk(() => updateTicket(orgId, params.id, body, actorOf(principal)));
  if (changes.length) await audit("ticket.update", { type: "ticket", id: ticket.id, name: `#${ticket.number} ${ticket.title}` }, { changes, status: ticket.status, priority: ticket.priority, assigneeId: ticket.assigneeId, resolution: body.resolution });
  return { ticket, changes };
});

/** Delete a ticket and its conversation. */
export const DELETE = api({ permission: "tickets.manage" }, async ({ orgId, params, principal, audit }) => {
  if (!(await getTicket(params.id, orgId, siteScope(principal, orgId)))) throw errors.notFound("Ticket not found");
  const ticket = await desk(() => deleteTicket(orgId, params.id, actorOf(principal)));
  await audit("ticket.delete", { type: "ticket", id: ticket.id, name: `#${ticket.number} ${ticket.title}` }, { number: ticket.number, status: ticket.status });
  return { ok: true, id: ticket.id };
});
