import { endpoint, type EndpointDoc } from "../registry";
import { AuditEntry, AuditListResponse, AuditQuery } from "../../contracts/audit";

const area: EndpointDoc[] = [
  endpoint({
    method: "GET", path: "/api/v1/audit", operationId: "listAuditLog", tag: "Audit log", permission: "audit.view", risk: "read",
    summary: "Search the audit log", query: AuditQuery, response: AuditListResponse,
    notes: ["Newest first, paginated.", "`action` matches a prefix (`auth.`, `device.`, `job.`); `q` searches action, actor, target, IP and details.", "`from`/`to` are ISO timestamps.", "`facets=1` adds the most common actions, target types and actors for filter menus.", "`export=csv` returns the filtered log (up to 50 000 rows) as a CSV attachment and audits the export."],
    aiHint: "Use to answer 'who changed X / who rebooted device Y / what did user Z do yesterday'. Filter by action prefix and time range, then open entries for details.",
  }),
  endpoint({
    method: "GET", path: "/api/v1/audit/{id}", operationId: "getAuditEntry", tag: "Audit log", permission: "audit.view", risk: "read",
    summary: "Get one audit entry", params: { id: "Audit entry id" }, response: AuditEntry,
    aiHint: "Use to read the full details object of a single audit entry.",
  }),
];
export default area;
