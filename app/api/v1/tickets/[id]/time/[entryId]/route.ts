import { api, errors } from "@/lib/api/route";
import { deleteTimeEntry, getTicket } from "@/lib/services/tickets";
import { siteScope } from "@/lib/services/device-access";
import { actorOf, desk } from "../../../_shared";

export const dynamic = "force-dynamic";

/** Remove a time entry; the ticket's total is reduced accordingly. */
export const DELETE = api({ permission: "tickets.manage" }, async ({ orgId, params, principal, audit }) => {
  if (!(await getTicket(params.id, orgId, siteScope(principal, orgId)))) throw errors.notFound("Ticket not found");
  const entry = await desk(() => deleteTimeEntry(orgId, params.id, params.entryId, actorOf(principal)));
  await audit("ticket.time.delete", { type: "ticket", id: params.id }, { entryId: entry.id, minutes: entry.minutes });
  return { ok: true };
});
