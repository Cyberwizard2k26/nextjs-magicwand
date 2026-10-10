import { api, ApiError } from "@/lib/api/route";
import { WebhookCreate } from "@/lib/api/contracts/webhooks";
import { createWebhook, listWebhooks } from "@/lib/services/webhooks";
import { ServiceError } from "@/lib/services/org";

export const dynamic = "force-dynamic";

/** Outbound webhooks of the organization with 7-day delivery stats. Secrets are never returned. */
export const GET = api({ permission: "integrations.manage" }, async ({ orgId }) => ({ items: await listWebhooks(orgId) }));

/** Create a webhook. The signing secret is returned once in `secret` (generated when omitted). */
export const POST = api({ permission: "integrations.manage", body: WebhookCreate }, async ({ orgId, body, principal, audit }) => {
  const r = await createWebhook(orgId, body, { id: principal.user?.id ?? null }).catch((e: unknown) => { throw e instanceof ServiceError ? new ApiError(e.status, e.message, e.code) : e; });
  await audit("webhook.created", { type: "webhook", id: r.webhook.id, name: r.webhook.name }, { url: r.webhook.url, events: r.webhook.events });
  return r;
});
