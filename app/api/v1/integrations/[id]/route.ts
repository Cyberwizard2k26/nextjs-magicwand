import { api, ApiError, errors } from "@/lib/api/route";
import { IntegrationPatch } from "@/lib/api/contracts/integrations";
import { deleteIntegration, getIntegration, updateIntegration } from "@/lib/services/integrations";
import { ServiceError } from "@/lib/services/org";

export const dynamic = "force-dynamic";

export const GET = api({ permission: "integrations.manage" }, async ({ orgId, params }) => {
  const row = await getIntegration(orgId, params.id);
  if (!row) throw errors.notFound("Integration not found");
  return row;
});

/** Update settings or credentials (an empty string removes a stored secret). Resets status to `unconfigured` until tested again. */
export const PATCH = api({ permission: "integrations.manage", body: IntegrationPatch }, async ({ orgId, params, body, audit }) => {
  const row = await updateIntegration(orgId, params.id, body).catch((e: unknown) => { throw e instanceof ServiceError ? new ApiError(e.status, e.message, e.code) : e; });
  if (!row) throw errors.notFound("Integration not found");
  await audit("integration.updated", { type: "integration", id: row.id, name: row.name }, { changed: Object.keys(body).filter((k) => k !== "secrets"), secretsChanged: Object.keys(body.secrets ?? {}) });
  return row;
});

export const DELETE = api({ permission: "integrations.manage" }, async ({ orgId, params, audit }) => {
  const row = await deleteIntegration(orgId, params.id);
  if (!row) throw errors.notFound("Integration not found");
  await audit("integration.deleted", { type: "integration", id: row.id, name: row.name }, { type: row.type });
  return { ok: true };
});
