import { api, errors } from "@/lib/api/route";
import { can } from "@/lib/auth/session";
import { CommentUpdate } from "@/lib/api/contracts/tickets";
import { deleteComment, getComment, getTicket, updateComment } from "@/lib/services/tickets";
import { siteScope } from "@/lib/services/device-access";
import { actorOf, desk } from "../../../_shared";

export const dynamic = "force-dynamic";

/** Edit a comment (author, or anyone with tickets.manage). */
export const PATCH = api({ permission: "tickets.view", body: CommentUpdate }, async ({ orgId, params, body, principal, audit }) => {
  if (!(await getTicket(params.id, orgId, siteScope(principal, orgId)))) throw errors.notFound("Ticket not found");
  const existing = await desk(() => getComment(orgId, params.id, params.commentId));
  if (existing.authorId !== principal.user?.id && !can(principal, "tickets.manage", orgId)) throw errors.forbidden("Only the author or a ticket manager can edit this comment");
  const comment = await desk(() => updateComment(orgId, params.id, params.commentId, body, actorOf(principal)));
  await audit("ticket.comment.update", { type: "ticket", id: params.id }, { commentId: comment.id, isInternal: comment.isInternal });
  return { comment };
});

/** Delete a comment (author, or anyone with tickets.manage). */
export const DELETE = api({ permission: "tickets.view" }, async ({ orgId, params, principal, audit }) => {
  if (!(await getTicket(params.id, orgId, siteScope(principal, orgId)))) throw errors.notFound("Ticket not found");
  const existing = await desk(() => getComment(orgId, params.id, params.commentId));
  if (existing.authorId !== principal.user?.id && !can(principal, "tickets.manage", orgId)) throw errors.forbidden("Only the author or a ticket manager can delete this comment");
  await desk(() => deleteComment(orgId, params.id, params.commentId, actorOf(principal)));
  await audit("ticket.comment.delete", { type: "ticket", id: params.id }, { commentId: params.commentId, authorType: existing.authorType });
  return { ok: true };
});
