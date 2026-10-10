/**
 * Ticket API contracts: the zod schemas shared by the route handlers (validation) and the OpenAPI area file
 * (documentation), so the published reference can never drift from what the server accepts.
 */
import { z } from "zod";

/** Same shape as `paginationQuery` in lib/api/route.ts, duplicated here so contracts stay free of Next.js imports (area files may be loaded at boot). */
export const pagination = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(500).default(50),
  q: z.string().optional().describe("Free-text search."),
  sort: z.string().optional(),
  dir: z.enum(["asc", "desc"]).optional(),
});

export const TICKET_STATUSES = ["new", "open", "pending", "on_hold", "resolved", "closed"] as const;
export const TICKET_PRIORITIES = ["low", "normal", "high", "urgent"] as const;
export const TICKET_TYPES = ["incident", "request", "problem", "change", "task", "alert"] as const;
export const TICKET_SOURCES = ["manual", "alert", "automation", "portal", "email", "tray", "api", "chat", "ai"] as const;
/** Statuses that count as "open work" for tiles, saved views and SLA timers. */
export const OPEN_STATUSES = ["new", "open", "pending", "on_hold"] as const;

export const ticketStatus = z.enum(TICKET_STATUSES);
export const ticketPriority = z.enum(TICKET_PRIORITIES);
export const ticketType = z.enum(TICKET_TYPES);
export const ticketSource = z.enum(TICKET_SOURCES);

/** Comma-separated or repeated query values -> string[] */
export const csvList = z.array(z.string()).or(z.string().transform((s) => s.split(",").map((x) => x.trim()).filter(Boolean)));
const flag = z.union([z.literal("1"), z.literal("true"), z.literal("0"), z.literal("false"), z.boolean()]).transform((v) => v === true || v === "1" || v === "true");
const isoDate = z.iso.datetime({ offset: true }).or(z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD"));
const tagList = z.array(z.string().trim().min(1).max(40)).max(30);

export const TicketListQuery = pagination.extend({
  status: csvList.optional().describe("One or more statuses (comma separated or repeated). Omit for every status."),
  priority: csvList.optional().describe("One or more priorities."),
  type: ticketType.optional(),
  category: z.string().max(80).optional(),
  assigneeId: z.string().optional().describe("User id, `me` for the caller, or `none` for unassigned tickets."),
  siteId: z.string().optional(),
  deviceId: z.string().optional(),
  contactId: z.string().optional(),
  alertId: z.string().optional(),
  tag: z.string().max(40).optional(),
  slaBreached: flag.optional().describe("Only tickets whose SLA has been breached."),
  dueToday: flag.optional().describe("Only open tickets due (dueAt or resolveDueAt) before the end of today."),
  updatedSince: isoDate.optional().describe("Only tickets updated at or after this timestamp."),
  summary: flag.optional().describe("Add `summary` (counts by status/priority, unassigned, due today, SLA breached, resolved this week)."),
  sort: z.enum(["number", "title", "status", "priority", "updatedAt", "createdAt", "dueAt", "resolveDueAt"]).optional(),
});
export type TicketListQuery = z.infer<typeof TicketListQuery>;

export const TicketCreate = z.object({
  title: z.string().trim().min(1).max(200),
  description: z.string().max(20_000).optional().describe("Markdown is rendered in the UI."),
  priority: ticketPriority.default("normal"),
  type: ticketType.default("incident"),
  category: z.string().trim().max(80).optional(),
  status: ticketStatus.optional().describe("Defaults to `new`."),
  siteId: z.string().optional(),
  deviceId: z.string().optional(),
  contactId: z.string().optional(),
  assigneeId: z.string().optional(),
  alertId: z.string().optional().describe("Create the ticket from an alert: links both sides (`alerts.ticketId` and `tickets.alertId`) and inherits the alert's device when `deviceId` is omitted."),
  tags: tagList.default([]),
  dueAt: isoDate.optional(),
  source: ticketSource.default("manual"),
  customFields: z.record(z.string(), z.unknown()).optional(),
  /** Optional first message, stored as the opening public comment. */
  comment: z.string().max(20_000).optional(),
});
export type TicketCreate = z.infer<typeof TicketCreate>;

export const TicketUpdate = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  description: z.string().max(20_000).nullable().optional(),
  status: ticketStatus.optional().describe("Transitions: new → open → pending/on_hold → resolved → closed; resolved/closed → open reopens. Stamps resolvedAt/closedAt."),
  priority: ticketPriority.optional(),
  type: ticketType.optional(),
  category: z.string().trim().max(80).nullable().optional(),
  siteId: z.string().nullable().optional(),
  deviceId: z.string().nullable().optional(),
  contactId: z.string().nullable().optional(),
  assigneeId: z.string().nullable().optional().describe("User id to assign, or null to unassign. Publishes `ticket.assigned`."),
  tags: tagList.optional(),
  dueAt: isoDate.nullable().optional(),
  aiSummary: z.string().max(8000).nullable().optional().describe("Short summary shown in the AI panel of the ticket; written by the copilot."),
  satisfactionRating: z.number().int().min(1).max(5).nullable().optional(),
  relatedTicketIds: z.array(z.string()).max(20).optional().describe("Link related tickets (merge-lite). Replaces the existing list."),
  customFields: z.record(z.string(), z.unknown()).optional().describe("Merged into the existing custom fields."),
  externalSystem: z.string().max(40).nullable().optional(),
  externalId: z.string().max(120).nullable().optional(),
  externalUrl: z.url().max(500).nullable().optional(),
  /** Reason recorded as a system event when closing/resolving. */
  resolution: z.string().max(4000).optional(),
});
export type TicketUpdate = z.infer<typeof TicketUpdate>;

export const Attachment = z.object({ id: z.string().min(1).max(500), name: z.string().min(1).max(255), size: z.number().int().min(0).default(0) });

export const CommentCreate = z.object({
  body: z.string().trim().min(1).max(20_000),
  isInternal: z.boolean().default(false).describe("Internal notes are hidden from the requester; public replies stamp `firstRespondedAt` and move a `new` ticket to `open`."),
  attachments: z.array(Attachment).max(20).default([]).describe("Reference-only attachments (name + size + id/URL); binary upload is not part of this endpoint."),
  authorType: z.enum(["user", "ai", "contact"]).optional().describe("Defaults to `user`; API operators acting as the copilot send `ai`."),
});
export type CommentCreate = z.infer<typeof CommentCreate>;

export const CommentUpdate = z.object({ body: z.string().trim().min(1).max(20_000).optional(), isInternal: z.boolean().optional(), attachments: z.array(Attachment).max(20).optional() });

export const TimeEntryCreate = z.object({
  minutes: z.number().int().min(1).max(24 * 60),
  note: z.string().max(2000).optional(),
  billable: z.boolean().default(true),
  startedAt: isoDate.optional(),
});
export type TimeEntryCreate = z.infer<typeof TimeEntryCreate>;

export const TicketBulk = z.object({
  ids: z.array(z.string()).min(1).max(500),
  action: z.enum(["assign", "status", "priority", "tag", "untag", "type", "delete"]),
  assigneeId: z.string().nullable().optional().describe("For `assign`: user id or null to unassign."),
  status: ticketStatus.optional(),
  priority: ticketPriority.optional(),
  type: ticketType.optional(),
  tag: z.string().trim().min(1).max(40).optional().describe("For `tag` / `untag`."),
});
export type TicketBulk = z.infer<typeof TicketBulk>;

export const LinkDevice = z.object({ deviceId: z.string().min(1) });

export const TicketExportQuery = TicketListQuery.omit({ page: true, pageSize: true, summary: true }).extend({ limit: z.coerce.number().int().min(1).max(10_000).default(5000) });

export const SlaTargets = z.object({
  low: z.object({ responseMinutes: z.number().int().min(1), resolveMinutes: z.number().int().min(1) }),
  normal: z.object({ responseMinutes: z.number().int().min(1), resolveMinutes: z.number().int().min(1) }),
  high: z.object({ responseMinutes: z.number().int().min(1), resolveMinutes: z.number().int().min(1) }),
  urgent: z.object({ responseMinutes: z.number().int().min(1), resolveMinutes: z.number().int().min(1) }),
});
export const BusinessHours = z.object({ timezone: z.string().min(1), days: z.array(z.number().int().min(0).max(6)).min(1), start: z.string().regex(/^\d{2}:\d{2}$/), end: z.string().regex(/^\d{2}:\d{2}$/) }).nullable();
export const SlaPolicyCreate = z.object({ name: z.string().trim().min(1).max(80), targets: SlaTargets, businessHours: BusinessHours.optional(), isDefault: z.boolean().default(false) });
export const SlaPolicyUpdate = SlaPolicyCreate.partial();

/* ----------------------------------------------------------------------------------------------- response shapes */

const ts = z.string().describe("ISO 8601 timestamp");
export const TicketRow = z.object({
  id: z.string(), number: z.number().int(), title: z.string(), status: ticketStatus, priority: ticketPriority, type: ticketType, category: z.string().nullable(),
  siteId: z.string().nullable(), siteName: z.string().nullable(), deviceId: z.string().nullable(), deviceName: z.string().nullable(), devicePlatform: z.string().nullable(), deviceStatus: z.string().nullable(),
  contactId: z.string().nullable(), contactName: z.string().nullable(), contactEmail: z.string().nullable(),
  assigneeId: z.string().nullable(), assigneeName: z.string().nullable(), assigneeAvatarUrl: z.string().nullable(),
  alertId: z.string().nullable(), source: ticketSource, tags: z.array(z.string()),
  firstResponseDueAt: ts.nullable(), resolveDueAt: ts.nullable(), firstRespondedAt: ts.nullable(), slaBreached: z.boolean(), dueAt: ts.nullable(),
  timeSpentMinutes: z.number().int(), satisfactionRating: z.number().int().nullable(), aiSummary: z.string().nullable(),
  commentCount: z.number().int(), lastCommentAt: ts.nullable(), lastCommentPreview: z.string().nullable(),
  resolvedAt: ts.nullable(), closedAt: ts.nullable(), createdBy: z.string().nullable(), createdAt: ts, updatedAt: ts,
});
export const TicketSummary = z.object({
  byStatus: z.record(z.string(), z.number().int()), byPriority: z.record(z.string(), z.number().int()),
  open: z.number().int(), unassigned: z.number().int(), dueToday: z.number().int(), breached: z.number().int(), atRisk: z.number().int(), resolvedThisWeek: z.number().int(), mine: z.number().int(),
});
export const TicketListResponse = z.object({ items: z.array(TicketRow), total: z.number().int(), page: z.number().int(), pageSize: z.number().int(), pages: z.number().int(), summary: TicketSummary.optional() });

export const TicketComment = z.object({ id: z.string(), ticketId: z.string(), authorType: z.enum(["user", "contact", "system", "ai"]), authorId: z.string().nullable(), authorName: z.string().nullable(), body: z.string(), isInternal: z.boolean(), attachments: z.array(Attachment), createdAt: ts, updatedAt: ts });
export const TimeEntry = z.object({ id: z.string(), ticketId: z.string().nullable(), userId: z.string(), userName: z.string().nullable(), minutes: z.number().int(), note: z.string().nullable(), billable: z.boolean(), startedAt: ts.nullable(), createdAt: ts });
export const TicketDetail = z.object({
  ticket: TicketRow.extend({ description: z.string().nullable(), customFields: z.record(z.string(), z.unknown()), externalSystem: z.string().nullable(), externalId: z.string().nullable(), externalUrl: z.string().nullable(), slaPolicyId: z.string().nullable() }),
  comments: z.array(TicketComment),
  timeEntries: z.array(TimeEntry),
  device: z.object({ id: z.string(), name: z.string(), platform: z.string(), status: z.string(), loggedInUser: z.string().nullable(), siteId: z.string().nullable(), osName: z.string().nullable() }).nullable(),
  contact: z.object({ id: z.string(), name: z.string(), email: z.string().nullable(), phone: z.string().nullable(), title: z.string().nullable(), isVip: z.boolean(), siteId: z.string().nullable() }).nullable(),
  assignee: z.object({ id: z.string(), name: z.string(), email: z.string(), avatarUrl: z.string().nullable() }).nullable(),
  alert: z.object({ id: z.string(), title: z.string(), severity: z.string(), status: z.string(), openedAt: ts }).nullable(),
  related: z.array(z.object({ id: z.string(), number: z.number().int(), title: z.string(), status: ticketStatus, priority: ticketPriority })),
  slaPolicy: z.object({ id: z.string(), name: z.string(), targets: SlaTargets }).nullable(),
  createdByName: z.string().nullable(),
});
export const Assignee = z.object({ id: z.string(), name: z.string(), email: z.string(), avatarUrl: z.string().nullable(), roleName: z.string(), openTickets: z.number().int() });
export const SlaPolicy = z.object({ id: z.string(), name: z.string(), targets: SlaTargets, businessHours: BusinessHours, isDefault: z.boolean(), createdAt: ts });
