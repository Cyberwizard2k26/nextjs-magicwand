import { api, errors } from "@/lib/api/route";
import { TimeEntryCreate } from "@/lib/api/contracts/tickets";
import { addTimeEntry, getTicket, listTimeEntries } from "@/lib/services/tickets";
import { siteScope } from "@/lib/services/device-access";
import { actorOf, desk } from "../../_shared";

export const dynamic = "force-dynamic";

/** Time entries logged against a ticket. */
export const GET = api({ permission: "tickets.view" }, async ({ orgId, params, principal }) => {
  if (!(await getTicket(params.id, orgId, siteScope(principal, orgId)))) throw errors.notFound("Ticket not found");
  const items = await desk(() => listTimeEntries(orgId, params.id));
  return { items, total: items.length, totalMinutes: items.reduce((a, e) => a + e.minutes, 0), billableMinutes: items.filter((e) => e.billable).reduce((a, e) => a + e.minutes, 0) };
});

/** Log time (minutes) on a ticket; the ticket's `timeSpentMinutes` is kept in sync. */
export const POST = api({ permission: "tickets.manage", body: TimeEntryCreate }, async ({ orgId, params, body, principal, audit }) => {
  if (!(await getTicket(params.id, orgId, siteScope(principal, orgId)))) throw errors.notFound("Ticket not found");
  const { entry, ticket } = await desk(() => addTimeEntry(orgId, params.id, body, actorOf(principal)));
  await audit("ticket.time.log", { type: "ticket", id: ticket.id, name: `#${ticket.number} ${ticket.title}` }, { entryId: entry.id, minutes: entry.minutes, billable: entry.billable });
  return { entry, ticket };
});
