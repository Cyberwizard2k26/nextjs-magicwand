import { api, errors } from "@/lib/api/route";
import { testIntegration } from "@/lib/services/integrations";

export const dynamic = "force-dynamic";

/** Validate required fields and check the endpoint answers; stores the outcome as the integration's status. */
export const POST = api({ permission: "integrations.manage" }, async ({ orgId, params, audit }) => {
  const r = await testIntegration(orgId, params.id);
  if (!r) throw errors.notFound("Integration not found");
  await audit("integration.tested", { type: "integration", id: params.id }, { ok: r.ok, checks: r.checks.map((c) => `${c.name}: ${c.ok ? "ok" : "failed"}`) });
  return r;
});
