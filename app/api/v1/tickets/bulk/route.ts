import { api, errors } from "@/lib/api/route";
import { TicketBulk } from "@/lib/api/contracts/tickets";
import { bulkTickets } from "@/lib/services/tickets";
import { siteScope } from "@/lib/services/device-access";
import { actorOf, desk } from "../_shared";

export const dynamic = "force-dynamic";

/** Assign / change status, priority, type / tag / untag / delete many tickets at once. */
export const POST = api({ permission: "tickets.manage", body: TicketBulk }, async ({ orgId, body, principal, audit }) => {
  if (body.action === "assign" && body.assigneeId === undefined) throw errors.badRequest("assigneeId is required (null to unassign)");
  if (body.action === "status" && !body.status) throw errors.badRequest("status is required");
  if (body.action === "priority" && !body.priority) throw errors.badRequest("priority is required");
  if (body.action === "type" && !body.type) throw errors.badRequest("type is required");
  if ((body.action === "tag" || body.action === "untag") && !body.tag) throw errors.badRequest("tag is required");
  const result = await desk(() => bulkTickets(orgId, body, actorOf(principal), siteScope(principal, orgId)));
  await audit(`ticket.bulk.${body.action}`, { type: "ticket", id: body.ids.length === 1 ? body.ids[0] : undefined }, { count: result.updated, failed: result.failed.length, ids: body.ids.slice(0, 50), assigneeId: body.assigneeId, status: body.status, priority: body.priority, type: body.type, tag: body.tag });
  return result;
});
