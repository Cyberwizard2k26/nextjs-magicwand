import { z } from "zod";
import { api, paginationQuery } from "@/lib/api/route";
import { listDevices } from "@/lib/services/device-query";

export const dynamic = "force-dynamic";

const list = z.array(z.string()).or(z.string().transform((s) => s.split(",").filter(Boolean)));

const Query = paginationQuery.extend({
  status: list.optional(),
  platform: list.optional(),
  deviceType: list.optional(),
  siteId: z.string().optional(),
  groupId: z.string().optional(),
  tag: z.string().optional(),
  healthBelow: z.coerce.number().optional(),
});

export const GET = api({ permission: "devices.view", query: Query }, async ({ orgId, query, principal }) => {
  const m = principal.memberships.find((x) => x.orgId === orgId);
  return listDevices({ orgId, ...query, siteIds: m?.siteIds?.length ? m.siteIds : undefined });
});
