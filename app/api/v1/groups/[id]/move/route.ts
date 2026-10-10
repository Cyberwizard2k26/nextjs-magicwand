import { z } from "zod";
import { api, errors } from "@/lib/api/route";
import { moveGroup } from "@/lib/services/groups";

export const dynamic = "force-dynamic";

/** Move a group one position up or down among its siblings. */
export const POST = api({ permission: "groups.manage", body: z.object({ direction: z.enum(["up", "down"]) }) }, async ({ orgId, params, body, audit }) => {
  const r = await moveGroup(orgId, params.id, body.direction);
  if (!r) throw errors.notFound("Group not found");
  if (r.moved) await audit("group.moved", { type: "group", id: params.id }, { direction: body.direction });
  return r;
});
