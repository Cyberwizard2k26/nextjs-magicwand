import { api } from "@/lib/api/route";
import { TicketCreate, TicketListQuery } from "@/lib/api/contracts/tickets";
import { createTicket, listTickets, ticketSummary } from "@/lib/services/tickets";
import { requireDevice, siteScope } from "@/lib/services/device-access";
import { actorOf, desk } from "./_shared";

export const dynamic = "force-dynamic";

/** List tickets with filters; `?summary=1` adds the tile counters. */
export const GET = api({ permission: "tickets.view", query: TicketListQuery }, async ({ orgId, query, principal }) => {
  const siteIds = siteScope(principal, orgId);
  const userId = principal.user?.id ?? null;
  const page = await listTickets({ ...query, orgId, userId, siteIds });
  return query.summary ? { ...page, summary: await ticketSummary(orgId, userId, siteIds) } : page;
});

/** Create a ticket (optionally from an alert, with an opening message). */
export const POST = api({ permission: "tickets.manage", body: TicketCreate }, async ({ orgId, body, principal, audit }) => {
  if (body.deviceId) await requireDevice(principal, orgId, body.deviceId);
  const ticket = await desk(() => createTicket(orgId, body, actorOf(principal)));
  await audit("ticket.create", { type: "ticket", id: ticket.id, name: `#${ticket.number} ${ticket.title}` }, { number: ticket.number, priority: ticket.priority, type: ticket.type, source: ticket.source, deviceId: ticket.deviceId, contactId: ticket.contactId, alertId: ticket.alertId });
  return { ticket };
});
