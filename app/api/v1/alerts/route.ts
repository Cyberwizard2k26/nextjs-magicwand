import { z } from "zod";
import { api, paginationQuery } from "@/lib/api/route";
import { alertCounts, listAlerts } from "@/lib/services/alerts";
import { siteScope } from "@/lib/services/device-access";

export const dynamic = "force-dynamic";

const list = z.array(z.string()).or(z.string().transform((s) => s.split(",").filter(Boolean)));
const Query = paginationQuery.extend({ status: list.optional(), severity: list.optional(), category: list.optional(), deviceId: z.string().optional(), counts: z.coerce.boolean().optional() });

export const GET = api({ permission: "alerts.view", query: Query }, async ({ orgId, query, principal }) => {
  const page = await listAlerts({ orgId, ...query, siteIds: siteScope(principal, orgId) });
  return query.counts ? { ...page, counts: await alertCounts(orgId) } : page;
});
