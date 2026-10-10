import { api } from "@/lib/api/route";
import { siteScope } from "@/lib/services/device-access";
import { deviceTree, listVirtualGroup } from "@/lib/services/device-tree";
import { DeviceTreeQuery } from "@/lib/api/contracts/device-notes";

export const dynamic = "force-dynamic";

/**
 * Session-group tree for the Access console: counts per site / platform / type / group / tag, virtual groups
 * (outdated agents, host connected, recently accessed, needs attention) and a live CPU/memory snapshot of online
 * devices. With `?list=<virtual group>` it returns that group's paginated device rows instead.
 */
export const GET = api({ permission: "devices.view", query: DeviceTreeQuery }, async ({ orgId, query, principal }) => {
  const siteIds = siteScope(principal, orgId);
  if (query.list) return listVirtualGroup({ orgId, siteIds, list: query.list, q: query.q, status: query.status, platform: query.platform, sort: query.sort, dir: query.dir, page: query.page, pageSize: query.pageSize });
  return deviceTree(orgId, siteIds);
});
