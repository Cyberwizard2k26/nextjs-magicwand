import { api, ApiError, errors } from "@/lib/api/route";
import { SiteDeleteQuery, SitePatch } from "@/lib/api/contracts/sites";
import { deleteSite, getSite, updateSite } from "@/lib/services/sites";
import { siteScope } from "@/lib/services/device-access";
import { ServiceError } from "@/lib/services/org";

export const dynamic = "force-dynamic";

const run = <T>(p: Promise<T>) => p.catch((e: unknown) => { throw e instanceof ServiceError ? new ApiError(e.status, e.message, e.code) : e; });

/** One site with its groups, scoped members and platform breakdown. */
export const GET = api({ permission: "devices.view" }, async ({ orgId, params, principal }) => {
  const scope = siteScope(principal, orgId);
  if (scope && !scope.includes(params.id)) throw errors.notFound("Site not found");
  const site = await getSite(orgId, params.id);
  if (!site) throw errors.notFound("Site not found");
  return site;
});

export const PATCH = api({ permission: "sites.manage", body: SitePatch }, async ({ orgId, params, body, audit }) => {
  const site = await run(updateSite(orgId, params.id, body));
  if (!site) throw errors.notFound("Site not found");
  await audit("site.updated", { type: "site", id: site.id, name: site.name }, { changed: Object.keys(body) });
  return site;
});

/** Delete a site. Refused (409) while devices are assigned unless `?reassignTo=<siteId>` moves them. */
export const DELETE = api({ permission: "sites.manage", query: SiteDeleteQuery }, async ({ orgId, params, query, audit }) => {
  const r = await run(deleteSite(orgId, params.id, query.reassignTo));
  if (!r) throw errors.notFound("Site not found");
  await audit("site.deleted", { type: "site", id: r.site.id, name: r.site.name }, { movedTo: r.movedTo?.id ?? null, devicesMoved: r.devicesMoved, membersUpdated: r.membersUpdated });
  return { ok: true, devicesMoved: r.devicesMoved, movedTo: r.movedTo };
});
