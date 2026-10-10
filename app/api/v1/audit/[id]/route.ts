import { api, errors } from "@/lib/api/route";
import { getAuditEntry } from "@/lib/services/audit-query";

export const dynamic = "force-dynamic";

export const GET = api({ permission: "audit.view" }, async ({ orgId, params }) => {
  const row = await getAuditEntry(orgId, params.id);
  if (!row) throw errors.notFound("Audit entry not found");
  return row;
});
