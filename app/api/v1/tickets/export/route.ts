import { api } from "@/lib/api/route";
import { TicketExportQuery } from "@/lib/api/contracts/tickets";
import { listTickets, ticketsToCsv } from "@/lib/services/tickets";
import { siteScope } from "@/lib/services/device-access";

export const dynamic = "force-dynamic";

/** CSV export of the tickets matching the same filters as the list endpoint. */
export const GET = api({ permission: "tickets.view", query: TicketExportQuery }, async ({ orgId, query, principal, audit }) => {
  const { limit, ...filters } = query;
  const page = await listTickets({ ...filters, orgId, userId: principal.user?.id ?? null, siteIds: siteScope(principal, orgId), page: 1, pageSize: limit });
  await audit("ticket.export", { type: "ticket" }, { rows: page.items.length, filters: { status: filters.status, priority: filters.priority, q: filters.q } });
  const stamp = new Date().toISOString().slice(0, 10);
  return new Response(ticketsToCsv(page.items), { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="tickets-${stamp}.csv"`, "cache-control": "no-store" } });
});
