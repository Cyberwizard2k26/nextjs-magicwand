import { z } from "zod";
import { endpoint, type EndpointDoc } from "../registry";
import { DeliveryListQuery, DeliverySchema, WebhookCreate, WebhookCreateResponse, WebhookPatch, WebhookSchema, WebhookTestResponse } from "../../contracts/webhooks";

const area: EndpointDoc[] = [
  endpoint({
    method: "GET", path: "/api/v1/webhooks", operationId: "listWebhooks", tag: "Webhooks", permission: "integrations.manage", risk: "read",
    summary: "List outbound webhooks", response: z.object({ items: z.array(WebhookSchema) }),
    notes: ["`stats` counts deliveries of the last 7 days; `failureCount` is the current consecutive-failure streak (a webhook is switched off automatically after 50)."],
    aiHint: "Use to see which external systems receive events and whether deliveries are failing.",
  }),
  endpoint({
    method: "POST", path: "/api/v1/webhooks", operationId: "createWebhook", tag: "Webhooks", permission: "integrations.manage", risk: "write",
    summary: "Create a webhook", body: WebhookCreate, response: WebhookCreateResponse,
    bodyExample: { name: "NOC Slack bridge", url: "https://hooks.example.com/magicwand", events: ["alert.opened", "alert.resolved", "device.offline"] },
    notes: ["Deliveries are POSTed as JSON `{ id, event, createdAt, attempt, data }` with headers `X-MagicWand-Event`, `X-MagicWand-Delivery` and `X-MagicWand-Signature: t=<unix>,v1=<hex HMAC-SHA256 of \"<t>.<body>\">`.", "`secret` is returned once (generated when omitted). Verify signatures with it.", "Failures retry with backoff (1m, 5m, 30m, 2h, 12h) up to 6 attempts.", "Emits `webhook.created`."],
    aiHint: "Use to push alerts, device state changes or job results to chat tools, SIEMs or ticketing systems.",
  }),
  endpoint({ method: "GET", path: "/api/v1/webhooks/events", operationId: "listWebhookEvents", tag: "Webhooks", permission: "integrations.manage", risk: "read", summary: "Event names available for subscription", response: z.object({ groups: z.array(z.object({ group: z.string(), events: z.array(z.string()) })) }), notes: ["Any dotted bus event name can be subscribed to; wildcards `alert.*` and `*` are accepted."], aiHint: "Use to pick valid event names when creating a webhook." }),
  endpoint({ method: "GET", path: "/api/v1/webhooks/{id}", operationId: "getWebhook", tag: "Webhooks", permission: "integrations.manage", risk: "read", summary: "Get a webhook", params: { id: "Webhook id" }, response: WebhookSchema, aiHint: "Use to read a webhook's URL and subscriptions." }),
  endpoint({ method: "PATCH", path: "/api/v1/webhooks/{id}", operationId: "updateWebhook", tag: "Webhooks", permission: "integrations.manage", risk: "write", summary: "Edit, enable/disable or rotate the secret of a webhook", params: { id: "Webhook id" }, body: WebhookPatch, response: WebhookCreateResponse, notes: ["`rotateSecret: true` (or a new `secret`) returns the new secret once.", "Re-enabling resets the failure streak.", "Emits `webhook.updated`."], aiHint: "Use to pause a noisy webhook, fix its URL or change subscriptions." }),
  endpoint({ method: "DELETE", path: "/api/v1/webhooks/{id}", operationId: "deleteWebhook", tag: "Webhooks", permission: "integrations.manage", risk: "dangerous", summary: "Delete a webhook and its delivery log", params: { id: "Webhook id" }, response: z.object({ ok: z.literal(true) }), aiHint: "Use to remove an integration endpoint that is no longer wanted." }),
  endpoint({ method: "POST", path: "/api/v1/webhooks/{id}/test", operationId: "testWebhook", tag: "Webhooks", permission: "integrations.manage", risk: "write", summary: "Send a signed test event now", params: { id: "Webhook id" }, response: WebhookTestResponse, notes: ["Delivers `webhook.test` immediately (no retries) and returns the endpoint's status, body excerpt and latency."], aiHint: "Use after creating or fixing a webhook to prove the endpoint accepts deliveries." }),
  endpoint({ method: "GET", path: "/api/v1/webhooks/{id}/deliveries", operationId: "listWebhookDeliveries", tag: "Webhooks", permission: "integrations.manage", risk: "read", summary: "Delivery log of a webhook", params: { id: "Webhook id" }, query: DeliveryListQuery, response: z.object({ items: z.array(DeliverySchema), total: z.number(), page: z.number(), pageSize: z.number(), pages: z.number() }), notes: ["Shows payload, attempts, response code/body (first 2000 chars) and the next retry time."], aiHint: "Use to debug why a receiver did not get an event: check status, response body and attempts." }),
  endpoint({ method: "POST", path: "/api/v1/webhooks/{id}/deliveries/{deliveryId}/redeliver", operationId: "redeliverWebhook", tag: "Webhooks", permission: "integrations.manage", risk: "write", summary: "Resend one delivery now", params: { id: "Webhook id", deliveryId: "Delivery id" }, response: WebhookTestResponse.omit({ deliveryId: true }), aiHint: "Use to replay a failed delivery after the receiving system was fixed." }),
];
export default area;
