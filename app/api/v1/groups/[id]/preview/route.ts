import { api, errors } from "@/lib/api/route";
import { GroupPreviewQuery } from "@/lib/api/contracts/groups";
import { listGroupDevices } from "@/lib/services/groups";
import { siteScope } from "@/lib/services/device-access";

export const dynamic = "force-dynamic";

/** Resolve the devices a (dynamic) group matches right now. */
export const GET = api({ permission: "devices.view", query: GroupPreviewQuery }, async ({ orgId, params, query, principal }) => {
  const page = await listGroupDevices(orgId, params.id, { ...query, siteIds: siteScope(principal, orgId) });
  if (!page) throw errors.notFound("Group not found");
  return page;
});
