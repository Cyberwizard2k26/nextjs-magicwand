import { z } from "zod";
import { PageQuery } from "./users";

const EventName = z.string().min(1).max(80).regex(/^(\*|[a-z0-9_]+(\.[a-z0-9_]+)*(\.\*)?)$/, "event names look like alert.opened, alert.* or *");

export const WebhookCreate = z.object({
  name: z.string().min(1).max(120),
  url: z.url().max(2048).refine((u) => /^https?:\/\//i.test(u), "must be an http(s) URL"),
  /** Event names or wildcards: `alert.*`, `device.online`, `*`. */
  events: z.array(EventName).min(1).max(100).default(["*"]),
  headers: z.record(z.string().max(80), z.string().max(1000)).default({}),
  /** Shared secret for the X-MagicWand-Signature HMAC. Generated when omitted; returned once. */
  secret: z.string().min(16).max(200).optional(),
  enabled: z.boolean().default(true),
});
export type WebhookCreateT = z.infer<typeof WebhookCreate>;
export const WebhookPatch = WebhookCreate.extend({ rotateSecret: z.boolean().optional() }).partial().refine((v) => Object.keys(v).length > 0, { message: "Nothing to update" });
export type WebhookPatchT = z.infer<typeof WebhookPatch>;

export const WebhookSchema = z.object({
  id: z.string(),
  name: z.string(),
  url: z.string(),
  events: z.array(z.string()),
  headers: z.record(z.string(), z.string()),
  enabled: z.boolean(),
  hasSecret: z.boolean(),
  failureCount: z.number().int(),
  lastDeliveryAt: z.string().nullable(),
  lastStatus: z.number().int().nullable(),
  createdBy: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  stats: z.object({ delivered: z.number(), failed: z.number(), pending: z.number() }).optional(),
});
export const WebhookCreateResponse = z.object({ webhook: WebhookSchema, secret: z.string().optional() });

export const DeliveryListQuery = PageQuery.extend({ status: z.enum(["pending", "delivered", "failed"]).optional(), event: z.string().optional() });
export const DeliverySchema = z.object({ id: z.string(), webhookId: z.string(), event: z.string(), payload: z.record(z.string(), z.unknown()), status: z.enum(["pending", "delivered", "failed"]), attempts: z.number().int(), responseCode: z.number().int().nullable(), responseBody: z.string().nullable(), nextRetryAt: z.string().nullable(), deliveredAt: z.string().nullable(), createdAt: z.string() });

export const WebhookTestResponse = z.object({ ok: z.boolean(), status: z.number().int().nullable(), durationMs: z.number(), body: z.string().nullable(), error: z.string().nullable(), deliveryId: z.string() });
