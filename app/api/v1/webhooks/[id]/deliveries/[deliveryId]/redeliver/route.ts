import { api, errors } from "@/lib/api/route";
import { redeliver } from "@/lib/services/webhooks";

export const dynamic = "force-dynamic";

/** Send one past delivery again right now. */
export const POST = api({ permission: "integrations.manage" }, async ({ orgId, params, audit }) => {
  const r = await redeliver(orgId, params.id, params.deliveryId);
  if (!r) throw errors.notFound("Delivery not found");
  await audit("webhook.redelivered", { type: "webhook", id: params.id }, { deliveryId: params.deliveryId, ok: r.ok, status: r.status });
  return r;
});
