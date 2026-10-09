import { z } from "zod";
import { api, errors } from "@/lib/api/route";
import { commentAlert, getAlert } from "@/lib/services/alerts";

export const dynamic = "force-dynamic";

export const GET = api({ permission: "alerts.view" }, async ({ orgId, params }) => {
  const detail = await getAlert(params.id, orgId);
  if (!detail) throw errors.notFound("Alert not found");
  return detail;
});

const Comment = z.object({ body: z.string().min(1).max(4000) });

/** Add a comment to an alert. */
export const POST = api({ permission: "alerts.view", body: Comment }, async ({ orgId, params, body, principal }) => {
  const comment = await commentAlert(orgId, params.id, { id: principal.user?.id ?? null, name: principal.user?.name ?? principal.user?.email ?? null }, body.body);
  if (!comment) throw errors.notFound("Alert not found");
  return { comment };
});
