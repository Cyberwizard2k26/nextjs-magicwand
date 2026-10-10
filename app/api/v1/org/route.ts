import { api, ApiError, errors } from "@/lib/api/route";
import { OrgPatch } from "@/lib/api/contracts/org";
import { getOrg, ServiceError, updateOrg } from "@/lib/services/org";

export const dynamic = "force-dynamic";

/** The active organization: profile, settings, branding and headline counts. */
export const GET = api({ permission: "org.view" }, async ({ orgId }) => {
  const org = await getOrg(orgId);
  if (!org) throw errors.notFound("Organization not found");
  return org;
});

/** Update name, settings (timezone, default site, retention, agent channel, security) and branding. Partial merge. */
export const PATCH = api({ permission: "org.manage", body: OrgPatch }, async ({ orgId, body, audit }) => {
  const row = await updateOrg(orgId, body).catch((e: unknown) => { throw e instanceof ServiceError ? new ApiError(e.status, e.message, e.code) : e; });
  if (!row) throw errors.notFound("Organization not found");
  await audit("org.updated", { type: "organization", id: orgId, name: row.name }, { changed: Object.keys(body), settings: body.settings, branding: body.branding, name: body.name });
  return (await getOrg(orgId))!;
});
