import { api, ApiError } from "@/lib/api/route";
import { IntegrationCreate, IntegrationListQuery } from "@/lib/api/contracts/integrations";
import { createIntegration, listIntegrations } from "@/lib/services/integrations";
import { ServiceError } from "@/lib/services/org";

export const dynamic = "force-dynamic";

/** Configured integrations plus the catalog of supported connector types (fields each one needs and what it does). */
export const GET = api({ permission: "integrations.manage", query: IntegrationListQuery }, async ({ orgId, query }) => listIntegrations(orgId, query));

/** Configure an integration. Credentials go in `secrets` and are encrypted at rest; test it afterwards with POST /integrations/{id}/test. */
export const POST = api({ permission: "integrations.manage", body: IntegrationCreate }, async ({ orgId, body, principal, audit }) => {
  const row = await createIntegration(orgId, body, { id: principal.user?.id ?? null }).catch((e: unknown) => { throw e instanceof ServiceError ? new ApiError(e.status, e.message, e.code) : e; });
  await audit("integration.created", { type: "integration", id: row.id, name: row.name }, { type: row.type, configKeys: Object.keys(row.config), secretKeys: row.secretKeys });
  return row;
});
