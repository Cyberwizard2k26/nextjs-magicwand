/**
 * Contact (end user) API contracts shared by the routes and the OpenAPI area file.
 */
import { z } from "zod";
import { pagination } from "./tickets";

const flag = z.union([z.literal("1"), z.literal("true"), z.literal("0"), z.literal("false"), z.boolean()]).transform((v) => v === true || v === "1" || v === "true");

export const ContactListQuery = pagination.extend({
  siteId: z.string().optional(),
  deviceId: z.string().optional().describe("Only contacts linked to this device."),
  isVip: flag.optional(),
  portalEnabled: flag.optional(),
  sort: z.enum(["name", "email", "createdAt", "updatedAt", "openTickets"]).optional(),
});
export type ContactListQuery = z.infer<typeof ContactListQuery>;

export const ContactCreate = z.object({
  name: z.string().trim().min(1).max(120),
  email: z.email().trim().max(254).nullable().optional(),
  phone: z.string().trim().max(40).nullable().optional(),
  title: z.string().trim().max(120).nullable().optional(),
  department: z.string().trim().max(120).nullable().optional(),
  siteId: z.string().nullable().optional(),
  isVip: z.boolean().default(false),
  portalEnabled: z.boolean().default(false),
  notes: z.string().max(4000).nullable().optional(),
  customFields: z.record(z.string(), z.unknown()).optional(),
  /** Devices to link on creation (first one becomes primary unless `primaryDeviceId` is set). */
  deviceIds: z.array(z.string()).max(50).optional(),
  primaryDeviceId: z.string().optional(),
});
export type ContactCreate = z.infer<typeof ContactCreate>;

export const ContactUpdate = ContactCreate.partial().omit({ deviceIds: true, primaryDeviceId: true });
export type ContactUpdate = z.infer<typeof ContactUpdate>;

export const ContactDeviceLink = z.object({ deviceId: z.string().min(1), isPrimary: z.boolean().default(false) });
export const ContactDeviceUnlink = z.object({ deviceId: z.string().min(1) });

const ts = z.string().describe("ISO 8601 timestamp");
export const ContactRow = z.object({
  id: z.string(), name: z.string(), email: z.string().nullable(), phone: z.string().nullable(), title: z.string().nullable(), department: z.string().nullable(),
  siteId: z.string().nullable(), siteName: z.string().nullable(), isVip: z.boolean(), portalEnabled: z.boolean(), notes: z.string().nullable(),
  deviceCount: z.number().int(), openTickets: z.number().int(), primaryDeviceId: z.string().nullable(), primaryDeviceName: z.string().nullable(), createdAt: ts, updatedAt: ts,
});
export const ContactListResponse = z.object({ items: z.array(ContactRow), total: z.number().int(), page: z.number().int(), pageSize: z.number().int(), pages: z.number().int() });
export const ContactDetail = z.object({
  contact: ContactRow.extend({ customFields: z.record(z.string(), z.unknown()) }),
  devices: z.array(z.object({ id: z.string(), name: z.string(), platform: z.string(), status: z.string(), loggedInUser: z.string().nullable(), lastSeenAt: ts.nullable(), isPrimary: z.boolean() })),
  tickets: z.array(z.object({ id: z.string(), number: z.number().int(), title: z.string(), status: z.string(), priority: z.string(), updatedAt: ts })),
  stats: z.object({ openTickets: z.number().int(), totalTickets: z.number().int(), avgSatisfaction: z.number().nullable() }),
});
