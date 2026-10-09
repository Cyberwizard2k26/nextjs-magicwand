import { pgTable, text, boolean, integer, serial, jsonb, index, uniqueIndex } from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { id, createdAt, updatedAt, tsNullable } from "./_common";
import { organizations, sites, users } from "./tenancy";
import { devices } from "./devices";

/* ---------------------------------------------------------------------------------------------
 * Service desk: tickets, comments, contacts (end users), time entries, SLAs
 * ------------------------------------------------------------------------------------------- */

export type TicketStatus = "new" | "open" | "pending" | "on_hold" | "resolved" | "closed";
export type TicketPriority = "low" | "normal" | "high" | "urgent";

export const contacts = pgTable(
  "contacts",
  {
    id: id(),
    orgId: text("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    siteId: text("site_id").references(() => sites.id, { onDelete: "set null" }),
    name: text("name").notNull(),
    email: text("email"),
    phone: text("phone"),
    title: text("title"),
    department: text("department"),
    /** Portal login (passwordless magic link / SSO). */
    portalEnabled: boolean("portal_enabled").notNull().default(false),
    portalPasswordHash: text("portal_password_hash"),
    isVip: boolean("is_vip").notNull().default(false),
    notes: text("notes"),
    customFields: jsonb("custom_fields").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("contacts_org_idx").on(t.orgId), index("contacts_email_idx").on(t.email)],
);

export const contactDevices = pgTable(
  "contact_devices",
  {
    contactId: text("contact_id").notNull().references(() => contacts.id, { onDelete: "cascade" }),
    deviceId: text("device_id").notNull().references(() => devices.id, { onDelete: "cascade" }),
    isPrimary: boolean("is_primary").notNull().default(false),
  },
  (t) => [uniqueIndex("contact_devices_idx").on(t.contactId, t.deviceId)],
);

export const slaPolicies = pgTable(
  "sla_policies",
  {
    id: id(),
    orgId: text("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    /** Minutes to first response / resolution per priority. */
    targets: jsonb("targets").$type<Record<TicketPriority, { responseMinutes: number; resolveMinutes: number }>>().notNull(),
    businessHours: jsonb("business_hours").$type<{ timezone: string; days: number[]; start: string; end: string } | null>(),
    isDefault: boolean("is_default").notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [index("sla_policies_org_idx").on(t.orgId)],
);

export const tickets = pgTable(
  "tickets",
  {
    id: id(),
    orgId: text("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    number: serial("number").notNull(),
    title: text("title").notNull(),
    description: text("description"),
    status: text("status").$type<TicketStatus>().notNull().default("new"),
    priority: text("priority").$type<TicketPriority>().notNull().default("normal"),
    type: text("type").$type<"incident" | "request" | "problem" | "change" | "task" | "alert">().notNull().default("incident"),
    category: text("category"),
    siteId: text("site_id").references(() => sites.id, { onDelete: "set null" }),
    deviceId: text("device_id").references(() => devices.id, { onDelete: "set null" }),
    contactId: text("contact_id").references(() => contacts.id, { onDelete: "set null" }),
    assigneeId: text("assignee_id").references(() => users.id, { onDelete: "set null" }),
    alertId: text("alert_id"),
    source: text("source").$type<"manual" | "alert" | "automation" | "portal" | "email" | "tray" | "api" | "chat" | "ai">().notNull().default("manual"),
    tags: jsonb("tags").$type<string[]>().notNull().default([]),
    slaPolicyId: text("sla_policy_id"),
    firstResponseDueAt: tsNullable("first_response_due_at"),
    resolveDueAt: tsNullable("resolve_due_at"),
    firstRespondedAt: tsNullable("first_responded_at"),
    slaBreached: boolean("sla_breached").notNull().default(false),
    dueAt: tsNullable("due_at"),
    timeSpentMinutes: integer("time_spent_minutes").notNull().default(0),
    /** PSA sync: external ticket id + system (connectwise/autotask/halo/jira/zendesk). */
    externalSystem: text("external_system"),
    externalId: text("external_id"),
    externalUrl: text("external_url"),
    customFields: jsonb("custom_fields").$type<Record<string, unknown>>().notNull().default({}),
    aiSummary: text("ai_summary"),
    satisfactionRating: integer("satisfaction_rating"),
    resolvedAt: tsNullable("resolved_at"),
    closedAt: tsNullable("closed_at"),
    createdBy: text("created_by"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("tickets_org_status_idx").on(t.orgId, t.status), index("tickets_device_idx").on(t.deviceId), index("tickets_assignee_idx").on(t.assigneeId), uniqueIndex("tickets_org_number_idx").on(t.orgId, t.number)],
);

export const ticketComments = pgTable(
  "ticket_comments",
  {
    id: id(),
    ticketId: text("ticket_id").notNull().references(() => tickets.id, { onDelete: "cascade" }),
    authorType: text("author_type").$type<"user" | "contact" | "system" | "ai">().notNull(),
    authorId: text("author_id"),
    authorName: text("author_name"),
    body: text("body").notNull(),
    isInternal: boolean("is_internal").notNull().default(false),
    attachments: jsonb("attachments").$type<{ id: string; name: string; size: number }[]>().notNull().default([]),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("ticket_comments_ticket_idx").on(t.ticketId, t.createdAt)],
);

export const timeEntries = pgTable(
  "time_entries",
  {
    id: id(),
    orgId: text("org_id").notNull(),
    ticketId: text("ticket_id").references(() => tickets.id, { onDelete: "cascade" }),
    sessionId: text("session_id"),
    userId: text("user_id").notNull(),
    minutes: integer("minutes").notNull(),
    note: text("note"),
    billable: boolean("billable").notNull().default(true),
    startedAt: tsNullable("started_at"),
    createdAt: createdAt(),
  },
  (t) => [index("time_entries_ticket_idx").on(t.ticketId), index("time_entries_user_idx").on(t.userId, t.createdAt)],
);

export const ticketsRelations = relations(tickets, ({ one, many }) => ({
  device: one(devices, { fields: [tickets.deviceId], references: [devices.id] }),
  contact: one(contacts, { fields: [tickets.contactId], references: [contacts.id] }),
  assignee: one(users, { fields: [tickets.assigneeId], references: [users.id] }),
  comments: many(ticketComments),
  timeEntries: many(timeEntries),
}));
export const ticketCommentsRelations = relations(ticketComments, ({ one }) => ({ ticket: one(tickets, { fields: [ticketComments.ticketId], references: [tickets.id] }) }));
export const timeEntriesRelations = relations(timeEntries, ({ one }) => ({ ticket: one(tickets, { fields: [timeEntries.ticketId], references: [tickets.id] }) }));
