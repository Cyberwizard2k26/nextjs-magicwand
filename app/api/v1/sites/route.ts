import { api, ApiError } from "@/lib/api/route";
import { SiteCreate, SiteListQuery } from "@/lib/api/contracts/sites";
import { createSite, listSites } from "@/lib/services/sites";
import { siteScope } from "@/lib/services/device-access";
import { ServiceError } from "@/lib/services/org";

export const dynamic = "force-dynamic";

/** Sites of the active org (limited to the caller's sites for site-scoped memberships), with device/group/member counts. */
export const GET = api({ permission: "devices.view", query: SiteListQuery }, async ({ orgId, principal, query }) => ({ items: await listSites(orgId, { q: query.q, siteIds: siteScope(principal, orgId) }) }));

/** Create a site. */
export const POST = api({ permission: "sites.manage", body: SiteCreate }, async ({ orgId, body, audit }) => {
  const site = await createSite(orgId, body).catch((e: unknown) => { throw e instanceof ServiceError ? new ApiError(e.status, e.message, e.code) : e; });
  await audit("site.created", { type: "site", id: site.id, name: site.name }, { timezone: site.timezone, address: site.address });
  return site;
});
