import { api, errors } from "@/lib/api/route";
import { CommentCreate } from "@/lib/api/contracts/tickets";
import { addComment, getTicket, listComments } from "@/lib/services/tickets";
import { siteScope } from "@/lib/services/device-access";
import { actorOf, desk } from "../../_shared";

export const dynamic = "force-dynamic";

/** Conversation of a ticket (public replies, internal notes and system events, oldest first). */
export const GET = api({ permission: "tickets.view" }, async ({ orgId, params, principal }) => {
  if (!(await getTicket(params.id, orgId, siteScope(principal, orgId)))) throw errors.notFound("Ticket not found");
  const items = await desk(() => listComments(orgId, params.id));
  return { items, total: items.length };
});

/** Reply to the requester or add an internal note. */
export const POST = api({ permission: "tickets.manage", body: CommentCreate }, async ({ orgId, params, body, principal, audit }) => {
  if (!(await getTicket(params.id, orgId, siteScope(principal, orgId)))) throw errors.notFound("Ticket not found");
  const { comment, ticket } = await desk(() => addComment(orgId, params.id, body, actorOf(principal)));
  await audit(body.isInternal ? "ticket.note" : "ticket.reply", { type: "ticket", id: ticket.id, name: `#${ticket.number} ${ticket.title}` }, { commentId: comment.id, isInternal: comment.isInternal, preview: body.body.slice(0, 120), attachments: body.attachments.length });
  return { comment, ticket };
});
