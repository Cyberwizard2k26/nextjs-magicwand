import { api, errors } from "@/lib/api/route";
import { testWebhook } from "@/lib/services/webhooks";

export const dynamic = "force-dynamic";

/** Send a signed `webhook.test` event now and report the endpoint's response. */
export const POST = api({ permission: "integrations.manage" }, async ({ orgId, params, principal, audit }) => {
  const r = await testWebhook(orgId, params.id, { name: principal.user?.name ?? principal.apiKey?.name ?? null });
  if (!r) throw errors.notFound("Webhook not found");
  await audit("webhook.tested", { type: "webhook", id: params.id }, { ok: r.ok, status: r.status, durationMs: r.durationMs });
  return r;
});
