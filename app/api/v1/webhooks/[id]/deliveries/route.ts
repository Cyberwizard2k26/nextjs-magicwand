import { api, errors } from "@/lib/api/route";
import { DeliveryListQuery } from "@/lib/api/contracts/webhooks";
import { listDeliveries } from "@/lib/services/webhooks";

export const dynamic = "force-dynamic";

/** Delivery log of one webhook (payload, attempts, response code/body, next retry). */
export const GET = api({ permission: "integrations.manage", query: DeliveryListQuery }, async ({ orgId, params, query }) => {
  const page = await listDeliveries(orgId, params.id, query);
  if (!page) throw errors.notFound("Webhook not found");
  return page;
});
