import { api, ApiError } from "@/lib/api/route";
import { AuditQuery } from "@/lib/api/contracts/audit";
import { auditFacets, exportAuditCsv, listAudit } from "@/lib/services/audit-query";
import { ServiceError } from "@/lib/services/org";

export const dynamic = "force-dynamic";

const run = <T>(p: Promise<T>) => p.catch((e: unknown) => { throw e instanceof ServiceError ? new ApiError(e.status, e.message, e.code) : e; });

/** The organization's audit log: who did what, to which target, from where. `?export=csv` streams a CSV; `?facets=1` adds filter facets. */
export const GET = api({ permission: "audit.view", query: AuditQuery }, async ({ orgId, query, audit }) => {
  if (query.export === "csv") {
    const csv = await run(exportAuditCsv(orgId, query));
    await audit("audit.exported", { type: "audit_log" }, { filters: { q: query.q, action: query.action, actorId: query.actorId, targetType: query.targetType, from: query.from, to: query.to }, rows: csv.split("\r\n").length - 2 });
    return new Response(csv, { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="audit-${new Date().toISOString().slice(0, 10)}.csv"` } });
  }
  const page = await run(listAudit(orgId, query));
  return query.facets ? { ...page, facets: await auditFacets(orgId) } : page;
});
