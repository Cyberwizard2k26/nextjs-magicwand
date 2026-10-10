import { api, ApiError, errors } from "@/lib/api/route";
import { WebhookPatch } from "@/lib/api/contracts/webhooks";
import { deleteWebhook, getWebhook, updateWebhook } from "@/lib/services/webhooks";
import { ServiceError } from "@/lib/services/org";

export const dynamic = "force-dynamic";

export const GET = api({ permission: "integrations.manage" }, async ({ orgId, params }) => {
  const w = await getWebhook(orgId, params.id);
  if (!w) throw errors.notFound("Webhook not found");
  return w;
});

/** Edit a webhook; `rotateSecret: true` or `secret` replaces the signing secret (returned once). Re-enabling resets the failure counter. */
export const PATCH = api({ permission: "integrations.manage", body: WebhookPatch }, async ({ orgId, params, body, audit }) => {
  const r = await updateWebhook(orgId, params.id, body).catch((e: unknown) => { throw e instanceof ServiceError ? new ApiError(e.status, e.message, e.code) : e; });
  if (!r) throw errors.notFound("Webhook not found");
  await audit("webhook.updated", { type: "webhook", id: r.webhook.id, name: r.webhook.name }, { changed: Object.keys(body).filter((k) => k !== "secret"), rotated: !!(body.secret || body.rotateSecret) });
  return r;
});

export const DELETE = api({ permission: "integrations.manage" }, async ({ orgId, params, audit }) => {
  const w = await deleteWebhook(orgId, params.id);
  if (!w) throw errors.notFound("Webhook not found");
  await audit("webhook.deleted", { type: "webhook", id: w.id, name: w.name }, { url: w.url });
  return { ok: true };
});
