import { api } from "@/lib/api/route";
import { listAssignees } from "@/lib/services/tickets";

export const dynamic = "force-dynamic";

/** Members of the active organization who can be assigned tickets, with their open-ticket load. */
export const GET = api({ permission: "tickets.view" }, async ({ orgId }) => {
  const items = await listAssignees(orgId);
  return { items, total: items.length };
});
