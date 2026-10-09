import { z } from "zod";
import { api, paginationQuery } from "@/lib/api/route";
import { devicesMissingPatch, fleetPatches, patchSummary } from "@/lib/services/patches";
import { siteScope } from "@/lib/services/device-access";

export const dynamic = "force-dynamic";

const list = z.array(z.string()).or(z.string().transform((s) => s.split(",").filter(Boolean)));
const Query = paginationQuery.extend({ status: list.optional(), severity: list.optional(), category: list.optional(), summary: z.coerce.boolean().optional(), externalId: z.string().optional() });

/** Fleet patch view. `?externalId=` lists the devices missing one patch; `?summary=1` adds compliance counters. */
export const GET = api({ permission: "patches.view", query: Query }, async ({ orgId, query, principal }) => {
  const scope = siteScope(principal, orgId);
  if (query.externalId) return { items: await devicesMissingPatch(orgId, query.externalId) };
  const page = await fleetPatches(orgId, { status: query.status, severity: query.severity, category: query.category, q: query.q, siteIds: scope, page: query.page, pageSize: query.pageSize });
  return query.summary ? { ...page, summary: await patchSummary(orgId, scope) } : page;
});
