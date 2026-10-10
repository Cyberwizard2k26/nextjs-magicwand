import { z } from "zod";
import { endpoint, type EndpointDoc } from "../registry";
import {
  Assignee, CommentCreate, CommentUpdate, LinkDevice, SlaPolicy, SlaPolicyCreate, SlaPolicyUpdate, TicketBulk, TicketComment, TicketCreate, TicketDetail, TicketExportQuery, TicketListQuery, TicketListResponse, TicketRow, TicketUpdate, TimeEntry, TimeEntryCreate,
} from "../../contracts/tickets";

const TAG = "Tickets";
const TICKET_EVENTS = "Realtime: publishes `ticket.*` events ({ ticketId, orgId, deviceId?, status, priority, number, title }) so open lists refresh.";
const idParam = { id: "Ticket id (uuid). The human-facing `number` is per organization and is not an id." };

/** Service desk: tickets, conversation, time tracking, SLA policies. */
const area: EndpointDoc[] = [
  endpoint({
    method: "GET", path: "/api/v1/tickets", operationId: "listTickets", tag: TAG, permission: "tickets.view", risk: "read",
    summary: "List tickets",
    description: "Paginated tickets of the active organization with requester, device, assignee and SLA columns. Site-scoped technicians only see tickets of their sites (by ticket site or device site).",
    query: TicketListQuery, response: TicketListResponse,
    notes: ["Default sort is `updatedAt desc`; `sort=priority` ranks urgent first.", "`assigneeId=me` / `assigneeId=none` are shortcuts for the caller / unassigned.", "`q` matches title, description, requester, device, category and `#number`.", "`summary=1` adds tile counters (open, unassigned, dueToday, breached, atRisk, resolvedThisWeek, mine, byStatus, byPriority)."],
    aiHint: "Use to find tickets to work on: open the queue with status=new,open, a user's tickets with contactId, or a device's history with deviceId.",
  }),
  endpoint({
    method: "POST", path: "/api/v1/tickets", operationId: "createTicket", tag: TAG, permission: "tickets.manage", risk: "write",
    summary: "Create a ticket",
    description: "Allocates the next per-organization ticket number, applies the default SLA policy (first-response and resolution targets by priority) and optionally links a device, contact, assignee or alert.",
    body: TicketCreate, response: z.object({ ticket: TicketRow.omit({ siteName: true, deviceName: true, devicePlatform: true, deviceStatus: true, contactName: true, contactEmail: true, assigneeName: true, assigneeAvatarUrl: true, commentCount: true, lastCommentAt: true, lastCommentPreview: true }) }),
    bodyExample: { title: "Outlook keeps asking for a password", description: "Started after the Monday reboot.", priority: "high", type: "incident", deviceId: "<device-id>", contactId: "<contact-id>", tags: ["email"], source: "ai" },
    notes: ["`alertId` links both sides (`alerts.ticketId`) and defaults the device, type (`alert`) and source (`alert`).", "`comment` stores an opening public message without counting as the first response.", "Audit: `ticket.create`.", TICKET_EVENTS, "Events: `ticket.created`, plus `ticket.assigned` when an assignee is given."],
    aiHint: "Create a ticket whenever a user reports a problem or you start remediation work that should be tracked; set source to `ai`.",
  }),
  endpoint({
    method: "GET", path: "/api/v1/tickets/export", operationId: "exportTicketsCsv", tag: TAG, permission: "tickets.view", risk: "read",
    summary: "Export tickets as CSV", description: "Same filters as the list endpoint; returns `text/csv` (up to `limit` rows, default 5000).",
    query: TicketExportQuery, response: { type: "string", format: "binary", description: "CSV document" },
    notes: ["Audit: `ticket.export`."], aiHint: "Use when the operator asks for a spreadsheet of tickets; prefer listTickets for reading data yourself.",
  }),
  endpoint({
    method: "GET", path: "/api/v1/tickets/assignees", operationId: "listTicketAssignees", tag: TAG, permission: "tickets.view", risk: "read",
    summary: "List assignable technicians", description: "Active members of the organization with their role and current open-ticket load.",
    response: z.object({ items: z.array(Assignee), total: z.number().int() }),
    aiHint: "Call before assigning to pick a technician by name and balance workload.",
  }),
  endpoint({
    method: "POST", path: "/api/v1/tickets/bulk", operationId: "bulkUpdateTickets", tag: TAG, permission: "tickets.manage", risk: "write",
    summary: "Bulk action on tickets", description: "Assign, change status/priority/type, tag/untag or delete up to 500 tickets. Each ticket is processed with the same rules as a single update (illegal transitions are reported in `failed`).",
    body: TicketBulk, response: z.object({ updated: z.number().int(), ids: z.array(z.string()), failed: z.array(z.object({ id: z.string(), error: z.string() })), skipped: z.number().int() }),
    bodyExample: { ids: ["<id1>", "<id2>"], action: "assign", assigneeId: "<user-id>" },
    notes: ["`delete` is destructive and permanent; confirm with the operator first.", "Audit: `ticket.bulk.<action>`.", TICKET_EVENTS],
    aiHint: "Use to triage many tickets at once (e.g. assign every unassigned urgent ticket to the on-call technician).",
  }),
  endpoint({
    method: "GET", path: "/api/v1/tickets/sla-policies", operationId: "listSlaPolicies", tag: TAG, permission: "tickets.view", risk: "read",
    summary: "List SLA policies", description: "Response/resolution targets in minutes per priority. A `Standard` default policy (urgent 15/120, high 30/240, normal 60/480, low 240/1440) is created lazily.",
    response: z.object({ items: z.array(SlaPolicy), total: z.number().int() }), aiHint: "Read to explain SLA deadlines or before changing targets.",
  }),
  endpoint({
    method: "POST", path: "/api/v1/tickets/sla-policies", operationId: "createSlaPolicy", tag: TAG, permission: "tickets.manage", risk: "write",
    summary: "Create an SLA policy", body: SlaPolicyCreate, response: z.object({ policy: SlaPolicy }),
    notes: ["`businessHours` (timezone, days 0-6, start/end HH:MM) pauses the clock outside working hours.", "`isDefault: true` makes it the policy applied to new tickets."], aiHint: "Only when the operator asks to change service levels.",
  }),
  endpoint({
    method: "PATCH", path: "/api/v1/tickets/sla-policies/{policyId}", operationId: "updateSlaPolicy", tag: TAG, permission: "tickets.manage", risk: "write",
    summary: "Update an SLA policy", params: { policyId: "SLA policy id" }, body: SlaPolicyUpdate, response: z.object({ policy: SlaPolicy }),
    notes: ["Existing tickets keep their computed due dates; new tickets use the updated targets."], aiHint: "Change response/resolution targets or business hours.",
  }),
  endpoint({
    method: "DELETE", path: "/api/v1/tickets/sla-policies/{policyId}", operationId: "deleteSlaPolicy", tag: TAG, permission: "tickets.manage", risk: "write",
    summary: "Delete an SLA policy", params: { policyId: "SLA policy id" }, response: z.object({ ok: z.boolean() }), notes: ["The default policy cannot be deleted."], aiHint: "Rarely needed; refuse for the default policy.",
  }),
  endpoint({
    method: "GET", path: "/api/v1/tickets/{id}", operationId: "getTicket", tag: TAG, permission: "tickets.view", risk: "read",
    summary: "Get a ticket", description: "Full ticket with description, conversation (public replies, internal notes, system events), time entries, linked device/contact/assignee/alert, related tickets and the SLA policy in force.",
    params: idParam, response: TicketDetail,
    aiHint: "Read before replying or changing a ticket so you know the history, the device and who the requester is.",
  }),
  endpoint({
    method: "PATCH", path: "/api/v1/tickets/{id}", operationId: "updateTicket", tag: TAG, permission: "tickets.manage", risk: "write",
    summary: "Update a ticket", description: "Edit fields, move status, assign, link device/contact, tag, set due date, write the AI summary or link related tickets. Status transitions: new → open → pending/on_hold → resolved → closed; resolved/closed → open reopens; `resolvedAt`/`closedAt` are stamped automatically. Changing priority recomputes SLA due dates.",
    params: idParam, body: TicketUpdate, response: z.object({ ticket: TicketRow.partial(), changes: z.array(z.string()) }),
    bodyExample: { status: "resolved", resolution: "Cleared the cached credentials and re-added the account." },
    notes: ["Illegal transitions return 409.", "Assigning a `new` ticket moves it to `open`.", "System events are written to the conversation for status, priority, assignee and device changes.", "Audit: `ticket.update` with the list of changed fields.", "Events: `ticket.updated` (with `changes`), `ticket.assigned` when the assignee changed."],
    aiHint: "Use to assign, prioritise, resolve or close a ticket; include a `resolution` when resolving. Write `aiSummary` after you have analysed the ticket.",
  }),
  endpoint({
    method: "DELETE", path: "/api/v1/tickets/{id}", operationId: "deleteTicket", tag: TAG, permission: "tickets.manage", risk: "dangerous",
    summary: "Delete a ticket", params: idParam, response: z.object({ ok: z.boolean(), id: z.string() }),
    notes: ["Permanent; comments and time entries are removed, linked alerts are unlinked.", "Audit: `ticket.delete`. Event: `ticket.deleted`."], aiHint: "Only on explicit operator request; prefer closing a ticket.",
  }),
  endpoint({
    method: "GET", path: "/api/v1/tickets/{id}/comments", operationId: "listTicketComments", tag: TAG, permission: "tickets.view", risk: "read",
    summary: "List the conversation", params: idParam, response: z.object({ items: z.array(TicketComment), total: z.number().int() }),
    notes: ["`authorType` is `user` (technician), `contact` (requester), `ai` or `system`; `isInternal` notes are never shown to requesters."], aiHint: "Read the thread before answering a user.",
  }),
  endpoint({
    method: "POST", path: "/api/v1/tickets/{id}/comments", operationId: "addTicketComment", tag: TAG, permission: "tickets.manage", risk: "write",
    summary: "Reply or add an internal note", params: idParam, body: CommentCreate, response: z.object({ comment: TicketComment, ticket: TicketRow.partial() }),
    bodyExample: { body: "Hi Dana, I have cleared the stuck credential. Could you try signing in again?", isInternal: false },
    notes: ["A public reply by a technician (or the AI) stamps `firstRespondedAt` and moves a `new` ticket to `open`.", "A requester (`authorType: contact`) replying to a `pending` ticket reopens it.", "Attachments are references only (name, size, id/URL).", "Audit: `ticket.reply` / `ticket.note`. Event: `ticket.comment.created`."],
    aiHint: "Use `isInternal: true` for your working notes and findings; use a public reply to talk to the end user.",
  }),
  endpoint({
    method: "PATCH", path: "/api/v1/tickets/{id}/comments/{commentId}", operationId: "updateTicketComment", tag: TAG, permission: "tickets.view", risk: "write",
    summary: "Edit a comment", params: { ...idParam, commentId: "Comment id" }, body: CommentUpdate, response: z.object({ comment: TicketComment }),
    notes: ["Allowed for the author, or anyone with tickets.manage. System events cannot be edited."], aiHint: "Fix a typo in a note you wrote.",
  }),
  endpoint({
    method: "DELETE", path: "/api/v1/tickets/{id}/comments/{commentId}", operationId: "deleteTicketComment", tag: TAG, permission: "tickets.view", risk: "write",
    summary: "Delete a comment", params: { ...idParam, commentId: "Comment id" }, response: z.object({ ok: z.boolean() }), notes: ["Allowed for the author, or anyone with tickets.manage."], aiHint: "Remove a note posted by mistake.",
  }),
  endpoint({
    method: "GET", path: "/api/v1/tickets/{id}/time", operationId: "listTicketTime", tag: TAG, permission: "tickets.view", risk: "read",
    summary: "List time entries", params: idParam, response: z.object({ items: z.array(TimeEntry), total: z.number().int(), totalMinutes: z.number().int(), billableMinutes: z.number().int() }), aiHint: "Report how much time was spent on a ticket.",
  }),
  endpoint({
    method: "POST", path: "/api/v1/tickets/{id}/time", operationId: "logTicketTime", tag: TAG, permission: "tickets.manage", risk: "write",
    summary: "Log time on a ticket", params: idParam, body: TimeEntryCreate, response: z.object({ entry: TimeEntry, ticket: TicketRow.partial() }),
    bodyExample: { minutes: 25, note: "Reset credentials, verified mail flow", billable: true },
    notes: ["Adds to `timeSpentMinutes` and writes a system event.", "Audit: `ticket.time.log`. Event: `ticket.time.logged`."], aiHint: "Log the time you spent after finishing remediation on a ticket.",
  }),
  endpoint({
    method: "DELETE", path: "/api/v1/tickets/{id}/time/{entryId}", operationId: "deleteTicketTime", tag: TAG, permission: "tickets.manage", risk: "write",
    summary: "Delete a time entry", params: { ...idParam, entryId: "Time entry id" }, response: z.object({ ok: z.boolean() }), notes: ["`timeSpentMinutes` is reduced accordingly."], aiHint: "Correct a mistaken time entry.",
  }),
  endpoint({
    method: "POST", path: "/api/v1/tickets/{id}/link-device", operationId: "linkTicketDevice", tag: TAG, permission: "tickets.manage", risk: "write",
    summary: "Link a device to the ticket", params: idParam, body: LinkDevice, response: z.object({ ticket: TicketRow.partial(), device: z.object({ id: z.string(), name: z.string(), platform: z.string(), status: z.string() }) }),
    notes: ["Replaces any existing link; the ticket inherits the device's site when it has none.", "Audit: `ticket.link_device`."], aiHint: "Attach the affected machine so remote tools and history are one click away.",
  }),
  endpoint({
    method: "DELETE", path: "/api/v1/tickets/{id}/link-device", operationId: "unlinkTicketDevice", tag: TAG, permission: "tickets.manage", risk: "write",
    summary: "Remove the device link", params: idParam, response: z.object({ ticket: TicketRow.partial() }), aiHint: "Use when a ticket was linked to the wrong device.",
  }),
];
export default area;
