/**
 * Service desk: tickets, comments, time entries and SLA policies.
 *
 * Loaded at boot by lib/modules/tickets (SLA sweep), so this file must not import Next.js-only helpers
 * (lib/api/route). It throws `DeskError` with a machine-readable code; routes translate to HTTP errors.
 *
 * Bus contract (the AI module subscribes to these names):
 *   ticket.created | ticket.updated | ticket.assigned | ticket.comment.created | ticket.sla_breached | ticket.deleted | ticket.time.logged
 *   payload: { ticketId, orgId, deviceId?, status, priority, number, title, ...extras }
 */
import { and, asc, desc, eq, gte, ilike, inArray, isNull, or, sql, type AnyColumn, type SQL } from "drizzle-orm";
import { getDb, schema } from "../db";
import { bus } from "../bus";
import type { TicketPriority, TicketStatus } from "../db/schema/tickets";

export type Ticket = typeof schema.tickets.$inferSelect;
export type TicketComment = typeof schema.ticketComments.$inferSelect;
export type TimeEntry = typeof schema.timeEntries.$inferSelect;
export type SlaPolicy = typeof schema.slaPolicies.$inferSelect;
export type SlaTargets = SlaPolicy["targets"];
export type BusinessHours = NonNullable<SlaPolicy["businessHours"]>;
export type TicketType = Ticket["type"];
export type TicketSource = Ticket["source"];
export type CommentAuthorType = TicketComment["authorType"];

export interface Actor { id: string | null; name: string | null; kind?: "user" | "apikey" }

export class DeskError extends Error {
  constructor(message: string, public code: "not_found" | "bad_request" | "conflict" | "forbidden" = "bad_request") {
    super(message);
    this.name = "DeskError";
  }
}

export const OPEN_STATUSES: TicketStatus[] = ["new", "open", "pending", "on_hold"];
/** Statuses whose SLA clock is running (pending / on_hold wait on someone else, so breaches are not raised there). */
export const SLA_RUNNING_STATUSES: TicketStatus[] = ["new", "open"];

export const DEFAULT_SLA_TARGETS: SlaTargets = {
  urgent: { responseMinutes: 15, resolveMinutes: 120 },
  high: { responseMinutes: 30, resolveMinutes: 240 },
  normal: { responseMinutes: 60, resolveMinutes: 480 },
  low: { responseMinutes: 240, resolveMinutes: 1440 },
};

/* ================================================================================================= pure helpers */

/** Allowed status transitions. A ticket may always stay where it is. */
export const TRANSITIONS: Record<TicketStatus, TicketStatus[]> = {
  new: ["open", "pending", "on_hold", "resolved", "closed"],
  open: ["pending", "on_hold", "resolved", "closed"],
  pending: ["open", "on_hold", "resolved", "closed"],
  on_hold: ["open", "pending", "resolved", "closed"],
  resolved: ["open", "closed"],
  closed: ["open"],
};

export function canTransition(from: TicketStatus, to: TicketStatus): boolean {
  return from === to || (TRANSITIONS[from] ?? []).includes(to);
}

/** Column patch for a status change: stamps resolvedAt / closedAt, clears them on reopen. Throws on an illegal move. */
export function transitionStamps(ticket: Pick<Ticket, "status" | "resolvedAt" | "closedAt">, to: TicketStatus, now = new Date()): Partial<Pick<Ticket, "status" | "resolvedAt" | "closedAt">> {
  if (to === ticket.status) return {};
  if (!canTransition(ticket.status, to)) throw new DeskError(`Ticket status cannot change from ${ticket.status.replace("_", " ")} to ${to.replace("_", " ")}`, "conflict");
  const patch: Partial<Pick<Ticket, "status" | "resolvedAt" | "closedAt">> = { status: to };
  if (to === "resolved") { patch.resolvedAt = ticket.resolvedAt ?? now; patch.closedAt = null; }
  else if (to === "closed") { patch.closedAt = now; patch.resolvedAt = ticket.resolvedAt ?? now; }
  else if (ticket.status === "resolved" || ticket.status === "closed") { patch.resolvedAt = null; patch.closedAt = null; }
  return patch;
}

function localParts(d: Date, timeZone: string): { weekday: number; minutes: number } {
  const fmt = new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false });
  const parts = Object.fromEntries(fmt.formatToParts(d).map((p) => [p.type, p.value]));
  const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(parts.weekday);
  const hour = Number(parts.hour) % 24; // "24" at midnight in some engines
  return { weekday, minutes: hour * 60 + Number(parts.minute) };
}
const hm = (s: string) => { const [h, m] = s.split(":").map(Number); return h * 60 + m; };

/**
 * Add `minutes` of working time to `start`. With no business hours the clock runs 24x7. Otherwise time outside the
 * configured window (or on non-business days) does not count; the result lands inside a window.
 */
export function addBusinessMinutes(start: Date, minutes: number, bh: BusinessHours | null | undefined): Date {
  if (!bh || !bh.days?.length) return new Date(start.getTime() + minutes * 60_000);
  const open = hm(bh.start), close = hm(bh.end);
  if (!(close > open)) return new Date(start.getTime() + minutes * 60_000);
  let cursor = new Date(start.getTime());
  let remaining = minutes;
  for (let guard = 0; guard < 400 && remaining > 0; guard++) {
    const { weekday, minutes: now } = localParts(cursor, bh.timezone || "UTC");
    const working = bh.days.includes(weekday) && now >= open && now < close;
    if (working) {
      const slice = Math.min(remaining, close - now);
      cursor = new Date(cursor.getTime() + slice * 60_000);
      remaining -= slice;
      continue;
    }
    // Jump to the next window start: later today if we are before opening, else tomorrow's opening.
    const jump = bh.days.includes(weekday) && now < open ? open - now : 1440 - now + open;
    cursor = new Date(cursor.getTime() + jump * 60_000);
  }
  return cursor;
}

/** SLA due dates for a ticket of `priority` opened at `from` under `policy` (null policy -> no targets). */
export function slaDueDates(policy: Pick<SlaPolicy, "targets" | "businessHours"> | null | undefined, priority: TicketPriority, from: Date): { firstResponseDueAt: Date | null; resolveDueAt: Date | null } {
  if (!policy) return { firstResponseDueAt: null, resolveDueAt: null };
  const t = policy.targets?.[priority] ?? DEFAULT_SLA_TARGETS[priority];
  return { firstResponseDueAt: addBusinessMinutes(from, t.responseMinutes, policy.businessHours), resolveDueAt: addBusinessMinutes(from, t.resolveMinutes, policy.businessHours) };
}

/** True when a ticket in this state is past one of its SLA targets. */
export function isSlaBreached(t: Pick<Ticket, "status" | "firstRespondedAt" | "firstResponseDueAt" | "resolveDueAt">, now = new Date()): boolean {
  if (!SLA_RUNNING_STATUSES.includes(t.status)) return false;
  if (!t.firstRespondedAt && t.firstResponseDueAt && t.firstResponseDueAt.getTime() < now.getTime()) return true;
  return !!t.resolveDueAt && t.resolveDueAt.getTime() < now.getTime();
}

export function isUniqueViolation(err: unknown): boolean {
  const e = err as { code?: string; cause?: { code?: string; message?: string }; message?: string } | null;
  const code = e?.code ?? e?.cause?.code;
  if (code === "23505") return true;
  return /duplicate key|unique constraint|UNIQUE/i.test(String(e?.cause?.message ?? e?.message ?? ""));
}

export function csvEscape(v: unknown): string {
  if (v === null || v === undefined) return "";
  const s = v instanceof Date ? v.toISOString() : Array.isArray(v) ? v.join("|") : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function ticketsToCsv(rows: TicketRow[]): string {
  const cols: [string, (r: TicketRow) => unknown][] = [
    ["number", (r) => r.number], ["title", (r) => r.title], ["status", (r) => r.status], ["priority", (r) => r.priority], ["type", (r) => r.type], ["category", (r) => r.category],
    ["contact", (r) => r.contactName], ["contactEmail", (r) => r.contactEmail], ["device", (r) => r.deviceName], ["site", (r) => r.siteName], ["assignee", (r) => r.assigneeName], ["tags", (r) => r.tags],
    ["source", (r) => r.source], ["slaBreached", (r) => r.slaBreached], ["firstResponseDueAt", (r) => r.firstResponseDueAt], ["resolveDueAt", (r) => r.resolveDueAt], ["firstRespondedAt", (r) => r.firstRespondedAt], ["dueAt", (r) => r.dueAt],
    ["timeSpentMinutes", (r) => r.timeSpentMinutes], ["satisfactionRating", (r) => r.satisfactionRating], ["createdAt", (r) => r.createdAt], ["updatedAt", (r) => r.updatedAt], ["resolvedAt", (r) => r.resolvedAt], ["closedAt", (r) => r.closedAt],
  ];
  const lines = [cols.map(([k]) => k).join(",")];
  for (const r of rows) lines.push(cols.map(([, f]) => csvEscape(f(r))).join(","));
  return lines.join("\r\n") + "\r\n";
}

/* ================================================================================================= SLA policies */

export async function ensureDefaultSlaPolicy(orgId: string): Promise<SlaPolicy> {
  const db = await getDb();
  const [existing] = await db.select().from(schema.slaPolicies).where(and(eq(schema.slaPolicies.orgId, orgId), eq(schema.slaPolicies.isDefault, true))).limit(1);
  if (existing) return existing;
  const [any] = await db.select().from(schema.slaPolicies).where(eq(schema.slaPolicies.orgId, orgId)).orderBy(asc(schema.slaPolicies.createdAt)).limit(1);
  if (any) return any;
  const [row] = await db.insert(schema.slaPolicies).values({ orgId, name: "Standard", targets: DEFAULT_SLA_TARGETS, businessHours: null, isDefault: true }).returning();
  return row;
}

export async function listSlaPolicies(orgId: string) {
  await ensureDefaultSlaPolicy(orgId);
  const db = await getDb();
  return db.select().from(schema.slaPolicies).where(eq(schema.slaPolicies.orgId, orgId)).orderBy(desc(schema.slaPolicies.isDefault), asc(schema.slaPolicies.name));
}

export async function createSlaPolicy(orgId: string, input: { name: string; targets: SlaTargets; businessHours?: BusinessHours | null; isDefault?: boolean }) {
  const db = await getDb();
  if (input.isDefault) await db.update(schema.slaPolicies).set({ isDefault: false }).where(eq(schema.slaPolicies.orgId, orgId));
  const [row] = await db.insert(schema.slaPolicies).values({ orgId, name: input.name, targets: input.targets, businessHours: input.businessHours ?? null, isDefault: !!input.isDefault }).returning();
  return row;
}

export async function updateSlaPolicy(orgId: string, id: string, patch: { name?: string; targets?: SlaTargets; businessHours?: BusinessHours | null; isDefault?: boolean }) {
  const db = await getDb();
  const [existing] = await db.select().from(schema.slaPolicies).where(and(eq(schema.slaPolicies.id, id), eq(schema.slaPolicies.orgId, orgId)));
  if (!existing) throw new DeskError("SLA policy not found", "not_found");
  if (patch.isDefault) await db.update(schema.slaPolicies).set({ isDefault: false }).where(eq(schema.slaPolicies.orgId, orgId));
  const [row] = await db.update(schema.slaPolicies).set({ ...(patch.name !== undefined && { name: patch.name }), ...(patch.targets && { targets: patch.targets }), ...(patch.businessHours !== undefined && { businessHours: patch.businessHours }), ...(patch.isDefault !== undefined && { isDefault: patch.isDefault || existing.isDefault }) }).where(eq(schema.slaPolicies.id, id)).returning();
  return row;
}

export async function deleteSlaPolicy(orgId: string, id: string) {
  const db = await getDb();
  const [existing] = await db.select().from(schema.slaPolicies).where(and(eq(schema.slaPolicies.id, id), eq(schema.slaPolicies.orgId, orgId)));
  if (!existing) throw new DeskError("SLA policy not found", "not_found");
  if (existing.isDefault) throw new DeskError("The default SLA policy cannot be deleted; make another policy the default first", "conflict");
  await db.delete(schema.slaPolicies).where(eq(schema.slaPolicies.id, id));
  return existing;
}

/* ================================================================================================= listing */

export interface TicketListParams {
  orgId: string;
  /** Caller's user id (resolves `assigneeId: "me"` and the `mine` summary). */
  userId?: string | null;
  /** Site scope of the caller (undefined = whole org). */
  siteIds?: string[];
  status?: string[]; priority?: string[]; type?: string; category?: string; assigneeId?: string; siteId?: string; deviceId?: string; contactId?: string; alertId?: string; tag?: string;
  slaBreached?: boolean; dueToday?: boolean; updatedSince?: string; q?: string; sort?: string; dir?: "asc" | "desc";
  page: number; pageSize: number;
}

const PRIORITY_RANK = sql`case ${schema.tickets.priority} when 'urgent' then 0 when 'high' then 1 when 'normal' then 2 else 3 end`;
const STATUS_RANK = sql`case ${schema.tickets.status} when 'new' then 0 when 'open' then 1 when 'pending' then 2 when 'on_hold' then 3 when 'resolved' then 4 else 5 end`;

function endOfToday() { const d = new Date(); d.setHours(23, 59, 59, 999); return d; }
function startOfWeek() { const d = new Date(); d.setHours(0, 0, 0, 0); const day = (d.getDay() + 6) % 7; d.setDate(d.getDate() - day); return d; }

function buildWhere(p: TicketListParams): SQL[] {
  const t = schema.tickets;
  const where: SQL[] = [eq(t.orgId, p.orgId)];
  if (p.siteIds?.length) where.push(or(inArray(t.siteId, p.siteIds), inArray(schema.devices.siteId, p.siteIds))!);
  if (p.status?.length) where.push(inArray(t.status, p.status as TicketStatus[]));
  if (p.priority?.length) where.push(inArray(t.priority, p.priority as TicketPriority[]));
  if (p.type) where.push(eq(t.type, p.type as TicketType));
  if (p.category) where.push(eq(t.category, p.category));
  if (p.assigneeId === "none") where.push(isNull(t.assigneeId));
  else if (p.assigneeId === "me") where.push(p.userId ? eq(t.assigneeId, p.userId) : sql`false`);
  else if (p.assigneeId) where.push(eq(t.assigneeId, p.assigneeId));
  if (p.siteId) where.push(eq(t.siteId, p.siteId));
  if (p.deviceId) where.push(eq(t.deviceId, p.deviceId));
  if (p.contactId) where.push(eq(t.contactId, p.contactId));
  if (p.alertId) where.push(eq(t.alertId, p.alertId));
  if (p.tag) where.push(sql`${t.tags} @> ${JSON.stringify([p.tag])}::jsonb`);
  if (p.slaBreached) where.push(eq(t.slaBreached, true));
  if (p.dueToday) { const end = endOfToday(); where.push(inArray(t.status, OPEN_STATUSES)); where.push(or(sql`${t.dueAt} <= ${end}`, sql`${t.resolveDueAt} <= ${end}`)!); }
  if (p.updatedSince) { const d = new Date(p.updatedSince); if (!Number.isNaN(d.getTime())) where.push(gte(t.updatedAt, d)); }
  if (p.q?.trim()) {
    const q = p.q.trim();
    const like = `%${q.replace(/[%_]/g, "\\$&")}%`;
    const clauses: SQL[] = [ilike(t.title, like), ilike(t.description, like), ilike(schema.contacts.name, like), ilike(schema.devices.name, like), ilike(t.category, like)];
    const num = /^#?(\d{1,9})$/.exec(q);
    if (num) clauses.push(eq(t.number, Number(num[1])));
    where.push(or(...clauses)!);
  }
  return where;
}

function orderFor(sort: string | undefined, dir: "asc" | "desc" | undefined): SQL[] {
  const t = schema.tickets;
  const d = (c: AnyColumn | SQL) => (dir === "asc" ? asc(c) : desc(c));
  switch (sort) {
    case "number": return [d(t.number)];
    case "title": return [dir === "desc" ? desc(t.title) : asc(t.title)];
    case "status": return [dir === "desc" ? desc(STATUS_RANK) : asc(STATUS_RANK), desc(t.updatedAt)];
    case "priority": return [dir === "desc" ? desc(PRIORITY_RANK) : asc(PRIORITY_RANK), desc(t.updatedAt)];
    case "createdAt": return [d(t.createdAt)];
    case "dueAt": return [dir === "desc" ? sql`${t.dueAt} desc nulls last` : sql`${t.dueAt} asc nulls last`];
    case "resolveDueAt": return [dir === "desc" ? sql`${t.resolveDueAt} desc nulls last` : sql`${t.resolveDueAt} asc nulls last`];
    case "updatedAt": return [d(t.updatedAt)];
    default: return [desc(t.updatedAt)];
  }
}

const rowSelect = () => {
  const t = schema.tickets;
  return {
    id: t.id, number: t.number, title: t.title, status: t.status, priority: t.priority, type: t.type, category: t.category,
    siteId: t.siteId, siteName: schema.sites.name, deviceId: t.deviceId, deviceName: schema.devices.name, devicePlatform: schema.devices.platform, deviceStatus: schema.devices.status,
    contactId: t.contactId, contactName: schema.contacts.name, contactEmail: schema.contacts.email,
    assigneeId: t.assigneeId, assigneeName: schema.users.name, assigneeAvatarUrl: schema.users.avatarUrl,
    alertId: t.alertId, source: t.source, tags: t.tags,
    firstResponseDueAt: t.firstResponseDueAt, resolveDueAt: t.resolveDueAt, firstRespondedAt: t.firstRespondedAt, slaBreached: t.slaBreached, dueAt: t.dueAt,
    timeSpentMinutes: t.timeSpentMinutes, satisfactionRating: t.satisfactionRating, aiSummary: t.aiSummary,
    commentCount: sql<number>`(select count(*)::int from ${schema.ticketComments} c where c.ticket_id = ${t}."id" and c.author_type <> 'system')`,
    lastCommentAt: sql<Date | null>`(select max(c.created_at) from ${schema.ticketComments} c where c.ticket_id = ${t}."id" and c.author_type <> 'system')`,
    lastCommentPreview: sql<string | null>`(select left(c.body, 160) from ${schema.ticketComments} c where c.ticket_id = ${t}."id" and c.author_type <> 'system' order by c.created_at desc limit 1)`,
    resolvedAt: t.resolvedAt, closedAt: t.closedAt, createdBy: t.createdBy, createdAt: t.createdAt, updatedAt: t.updatedAt,
  };
};
export type TicketRow = Awaited<ReturnType<typeof listTickets>>["items"][number];

export async function listTickets(p: TicketListParams) {
  const db = await getDb();
  const t = schema.tickets;
  const where = and(...buildWhere(p));
  const base = () => db.select(rowSelect()).from(t).leftJoin(schema.devices, eq(schema.devices.id, t.deviceId)).leftJoin(schema.contacts, eq(schema.contacts.id, t.contactId)).leftJoin(schema.users, eq(schema.users.id, t.assigneeId)).leftJoin(schema.sites, eq(schema.sites.id, t.siteId));
  const [{ total }] = await db.select({ total: sql<number>`count(*)::int` }).from(t).leftJoin(schema.devices, eq(schema.devices.id, t.deviceId)).leftJoin(schema.contacts, eq(schema.contacts.id, t.contactId)).where(where);
  const items = await base().where(where).orderBy(...orderFor(p.sort, p.dir)).limit(p.pageSize).offset((p.page - 1) * p.pageSize);
  return { items, total, page: p.page, pageSize: p.pageSize, pages: Math.max(1, Math.ceil(total / p.pageSize)) };
}

export async function ticketSummary(orgId: string, userId: string | null | undefined, siteIds?: string[]) {
  const db = await getDb();
  const t = schema.tickets;
  const scope = and(eq(t.orgId, orgId), siteIds?.length ? or(inArray(t.siteId, siteIds), inArray(schema.devices.siteId, siteIds)) : undefined);
  const open = inArray(t.status, OPEN_STATUSES);
  const running = inArray(t.status, SLA_RUNNING_STATUSES);
  const end = endOfToday();
  const soon = new Date(Date.now() + 60 * 60_000);
  const [statusRows, prioRows, [agg]] = await Promise.all([
    db.select({ status: t.status, n: sql<number>`count(*)::int` }).from(t).leftJoin(schema.devices, eq(schema.devices.id, t.deviceId)).where(scope).groupBy(t.status),
    db.select({ priority: t.priority, n: sql<number>`count(*)::int` }).from(t).leftJoin(schema.devices, eq(schema.devices.id, t.deviceId)).where(and(scope, open)).groupBy(t.priority),
    db.select({
      open: sql<number>`count(*) filter (where ${open})::int`,
      unassigned: sql<number>`count(*) filter (where ${open} and ${t.assigneeId} is null)::int`,
      dueToday: sql<number>`count(*) filter (where ${open} and (${t.dueAt} <= ${end} or ${t.resolveDueAt} <= ${end}))::int`,
      breached: sql<number>`count(*) filter (where ${open} and ${t.slaBreached})::int`,
      atRisk: sql<number>`count(*) filter (where ${running} and not ${t.slaBreached} and ((${t.firstRespondedAt} is null and ${t.firstResponseDueAt} <= ${soon}) or ${t.resolveDueAt} <= ${soon}))::int`,
      resolvedThisWeek: sql<number>`count(*) filter (where ${t.resolvedAt} >= ${startOfWeek()})::int`,
      mine: userId ? sql<number>`count(*) filter (where ${open} and ${t.assigneeId} = ${userId})::int` : sql<number>`0`,
    }).from(t).leftJoin(schema.devices, eq(schema.devices.id, t.deviceId)).where(scope),
  ]);
  const byStatus: Record<string, number> = {};
  for (const r of statusRows) byStatus[r.status] = r.n;
  const byPriority: Record<string, number> = {};
  for (const r of prioRows) byPriority[r.priority] = r.n;
  return { byStatus, byPriority, ...agg };
}

/* ================================================================================================= detail */

export async function getTicket(id: string, orgId: string, siteIds?: string[]) {
  const db = await getDb();
  const t = schema.tickets;
  const [row] = await db.select(rowSelect()).from(t).leftJoin(schema.devices, eq(schema.devices.id, t.deviceId)).leftJoin(schema.contacts, eq(schema.contacts.id, t.contactId)).leftJoin(schema.users, eq(schema.users.id, t.assigneeId)).leftJoin(schema.sites, eq(schema.sites.id, t.siteId)).where(and(eq(t.id, id), eq(t.orgId, orgId)));
  if (!row) return null;
  const [full] = await db.select({ description: t.description, customFields: t.customFields, externalSystem: t.externalSystem, externalId: t.externalId, externalUrl: t.externalUrl, slaPolicyId: t.slaPolicyId }).from(t).where(eq(t.id, id));
  const device = row.deviceId ? (await db.select({ id: schema.devices.id, name: schema.devices.name, platform: schema.devices.platform, status: schema.devices.status, loggedInUser: schema.devices.loggedInUser, siteId: schema.devices.siteId, osName: schema.devices.osName }).from(schema.devices).where(eq(schema.devices.id, row.deviceId)))[0] ?? null : null;
  if (siteIds?.length && !(row.siteId && siteIds.includes(row.siteId)) && !(device?.siteId && siteIds.includes(device.siteId))) return null;
  const [contact, assignee, alert, comments, timeRows, policy, creator] = await Promise.all([
    row.contactId ? db.select({ id: schema.contacts.id, name: schema.contacts.name, email: schema.contacts.email, phone: schema.contacts.phone, title: schema.contacts.title, isVip: schema.contacts.isVip, siteId: schema.contacts.siteId }).from(schema.contacts).where(eq(schema.contacts.id, row.contactId)).then((r) => r[0] ?? null) : null,
    row.assigneeId ? db.select({ id: schema.users.id, name: schema.users.name, email: schema.users.email, avatarUrl: schema.users.avatarUrl }).from(schema.users).where(eq(schema.users.id, row.assigneeId)).then((r) => r[0] ?? null) : null,
    row.alertId ? db.select({ id: schema.alerts.id, title: schema.alerts.title, severity: schema.alerts.severity, status: schema.alerts.status, openedAt: schema.alerts.openedAt }).from(schema.alerts).where(and(eq(schema.alerts.id, row.alertId), eq(schema.alerts.orgId, orgId))).then((r) => r[0] ?? null) : null,
    db.select().from(schema.ticketComments).where(eq(schema.ticketComments.ticketId, id)).orderBy(asc(schema.ticketComments.createdAt)),
    db.select({ id: schema.timeEntries.id, ticketId: schema.timeEntries.ticketId, userId: schema.timeEntries.userId, userName: schema.users.name, minutes: schema.timeEntries.minutes, note: schema.timeEntries.note, billable: schema.timeEntries.billable, startedAt: schema.timeEntries.startedAt, createdAt: schema.timeEntries.createdAt }).from(schema.timeEntries).leftJoin(schema.users, eq(schema.users.id, schema.timeEntries.userId)).where(eq(schema.timeEntries.ticketId, id)).orderBy(asc(schema.timeEntries.createdAt)),
    full?.slaPolicyId ? db.select({ id: schema.slaPolicies.id, name: schema.slaPolicies.name, targets: schema.slaPolicies.targets }).from(schema.slaPolicies).where(eq(schema.slaPolicies.id, full.slaPolicyId)).then((r) => r[0] ?? null) : null,
    row.createdBy ? db.select({ name: schema.users.name }).from(schema.users).where(eq(schema.users.id, row.createdBy)).then((r) => r[0]?.name ?? null) : null,
  ]);
  const relatedIds = Array.isArray(full?.customFields?.relatedTicketIds) ? (full!.customFields.relatedTicketIds as string[]).filter((x) => typeof x === "string") : [];
  const related = relatedIds.length ? await db.select({ id: t.id, number: t.number, title: t.title, status: t.status, priority: t.priority }).from(t).where(and(eq(t.orgId, orgId), inArray(t.id, relatedIds))) : [];
  const authorIds = [...new Set(comments.filter((c) => c.authorType === "user" && c.authorId).map((c) => c.authorId!))];
  const avatars = authorIds.length ? await db.select({ id: schema.users.id, avatarUrl: schema.users.avatarUrl }).from(schema.users).where(inArray(schema.users.id, authorIds)) : [];
  const avatarById = new Map(avatars.map((a) => [a.id, a.avatarUrl]));
  return {
    ticket: { ...row, description: full?.description ?? null, customFields: full?.customFields ?? {}, externalSystem: full?.externalSystem ?? null, externalId: full?.externalId ?? null, externalUrl: full?.externalUrl ?? null, slaPolicyId: full?.slaPolicyId ?? null },
    comments: comments.map((c) => ({ ...c, authorAvatarUrl: c.authorId ? avatarById.get(c.authorId) ?? null : null })),
    timeEntries: timeRows,
    device, contact, assignee, alert, related, slaPolicy: policy, createdByName: creator,
  };
}
export type TicketDetail = NonNullable<Awaited<ReturnType<typeof getTicket>>>;

async function loadTicket(id: string, orgId: string): Promise<Ticket> {
  const db = await getDb();
  const [row] = await db.select().from(schema.tickets).where(and(eq(schema.tickets.id, id), eq(schema.tickets.orgId, orgId)));
  if (!row) throw new DeskError("Ticket not found", "not_found");
  return row;
}

function eventPayload(t: Pick<Ticket, "id" | "orgId" | "deviceId" | "status" | "priority" | "number" | "title">, extra: Record<string, unknown> = {}) {
  return { ticketId: t.id, orgId: t.orgId, deviceId: t.deviceId ?? undefined, status: t.status, priority: t.priority, number: t.number, title: t.title, ...extra };
}
function publish(name: string, t: Pick<Ticket, "id" | "orgId" | "deviceId" | "status" | "priority" | "number" | "title">, extra: Record<string, unknown> = {}) {
  bus.publish(name, eventPayload(t, extra), { orgId: t.orgId, deviceId: t.deviceId });
}

async function systemEvent(ticketId: string, body: string, actor?: Actor | null) {
  const db = await getDb();
  const [row] = await db.insert(schema.ticketComments).values({ ticketId, authorType: "system", authorId: actor?.id ?? null, authorName: actor?.name ?? null, body, isInternal: true }).returning();
  return row;
}

/* ================================================================================================= reference checks */

async function assertContact(orgId: string, contactId: string) {
  const db = await getDb();
  const [c] = await db.select({ id: schema.contacts.id, siteId: schema.contacts.siteId }).from(schema.contacts).where(and(eq(schema.contacts.id, contactId), eq(schema.contacts.orgId, orgId)));
  if (!c) throw new DeskError("Contact not found", "not_found");
  return c;
}
async function assertDevice(orgId: string, deviceId: string) {
  const db = await getDb();
  const [d] = await db.select({ id: schema.devices.id, siteId: schema.devices.siteId, name: schema.devices.name }).from(schema.devices).where(and(eq(schema.devices.id, deviceId), eq(schema.devices.orgId, orgId)));
  if (!d) throw new DeskError("Device not found", "not_found");
  return d;
}
async function assertSite(orgId: string, siteId: string) {
  const db = await getDb();
  const [s] = await db.select({ id: schema.sites.id }).from(schema.sites).where(and(eq(schema.sites.id, siteId), eq(schema.sites.orgId, orgId)));
  if (!s) throw new DeskError("Site not found", "not_found");
  return s;
}
async function assertAssignee(orgId: string, userId: string) {
  const db = await getDb();
  const [m] = await db.select({ id: schema.users.id, name: schema.users.name }).from(schema.memberships).innerJoin(schema.users, eq(schema.users.id, schema.memberships.userId)).where(and(eq(schema.memberships.orgId, orgId), eq(schema.memberships.userId, userId)));
  if (!m) throw new DeskError("Assignee is not a member of this organization", "bad_request");
  return m;
}

/* ================================================================================================= create */

export interface TicketCreateInput {
  title: string; description?: string; priority?: TicketPriority; type?: TicketType; category?: string; status?: TicketStatus; siteId?: string; deviceId?: string; contactId?: string; assigneeId?: string; alertId?: string;
  tags?: string[]; dueAt?: string; source?: TicketSource; customFields?: Record<string, unknown>; comment?: string;
}

/** Create a ticket with a per-org sequential number (max+1 inside a transaction, retried on a unique violation). */
export async function createTicket(orgId: string, input: TicketCreateInput, actor: Actor): Promise<Ticket> {
  const db = await getDb();
  let deviceId = input.deviceId ?? null;
  let siteId = input.siteId ?? null;
  let alert: { id: string; deviceId: string | null; title: string; siteId: string | null } | null = null;
  if (input.alertId) {
    [alert] = await db.select({ id: schema.alerts.id, deviceId: schema.alerts.deviceId, title: schema.alerts.title, siteId: schema.alerts.siteId }).from(schema.alerts).where(and(eq(schema.alerts.id, input.alertId), eq(schema.alerts.orgId, orgId)));
    if (!alert) throw new DeskError("Alert not found", "not_found");
    deviceId ??= alert.deviceId;
  }
  const device = deviceId ? await assertDevice(orgId, deviceId) : null;
  const contact = input.contactId ? await assertContact(orgId, input.contactId) : null;
  if (siteId) await assertSite(orgId, siteId);
  siteId ??= device?.siteId ?? contact?.siteId ?? alert?.siteId ?? null;
  const assignee = input.assigneeId ? await assertAssignee(orgId, input.assigneeId) : null;
  const priority = input.priority ?? "normal";
  const policy = await ensureDefaultSlaPolicy(orgId);
  const now = new Date();
  const due = slaDueDates(policy, priority, now);
  const status = input.status ?? "new";
  const stamps = status === "resolved" ? { resolvedAt: now } : status === "closed" ? { resolvedAt: now, closedAt: now } : {};

  let created: Ticket | null = null;
  let lastErr: unknown;
  for (let attempt = 0; attempt < 6 && !created; attempt++) {
    try {
      created = await db.transaction(async (tx) => {
        const [{ max }] = await tx.select({ max: sql<number>`coalesce(max(${schema.tickets.number}), 0)::int` }).from(schema.tickets).where(eq(schema.tickets.orgId, orgId));
        const [row] = await tx.insert(schema.tickets).values({
          orgId, number: max + 1, title: input.title, description: input.description ?? null, status, priority, type: input.type ?? (alert ? "alert" : "incident"), category: input.category ?? null,
          siteId, deviceId, contactId: contact?.id ?? null, assigneeId: assignee?.id ?? null, alertId: alert?.id ?? null, source: input.source ?? (alert ? "alert" : "manual"), tags: [...new Set(input.tags ?? [])],
          slaPolicyId: policy.id, firstResponseDueAt: due.firstResponseDueAt, resolveDueAt: due.resolveDueAt, dueAt: input.dueAt ? new Date(input.dueAt) : null,
          customFields: input.customFields ?? {}, createdBy: actor.id, ...stamps,
        }).returning();
        return row;
      });
    } catch (err) {
      lastErr = err;
      if (!isUniqueViolation(err)) throw err;
    }
  }
  if (!created) throw lastErr instanceof Error ? lastErr : new DeskError("Could not allocate a ticket number", "conflict");

  if (input.comment?.trim()) {
    await db.insert(schema.ticketComments).values({ ticketId: created.id, authorType: contact && actor.kind !== "apikey" ? "user" : actor.kind === "apikey" ? "ai" : "user", authorId: actor.id, authorName: actor.name, body: input.comment.trim(), isInternal: false });
  }
  if (alert) await db.update(schema.alerts).set({ ticketId: created.id }).where(eq(schema.alerts.id, alert.id));
  if (assignee) await systemEvent(created.id, `Assigned to ${assignee.name}`, actor);
  publish("ticket.created", created, { source: created.source, by: actor.name, contactId: created.contactId, assigneeId: created.assigneeId });
  if (assignee) publish("ticket.assigned", created, { assigneeId: assignee.id, assigneeName: assignee.name, by: actor.name });
  return created;
}

/* ================================================================================================= update */

export interface TicketUpdateInput {
  title?: string; description?: string | null; status?: TicketStatus; priority?: TicketPriority; type?: TicketType; category?: string | null; siteId?: string | null; deviceId?: string | null; contactId?: string | null; assigneeId?: string | null;
  tags?: string[]; dueAt?: string | null; aiSummary?: string | null; satisfactionRating?: number | null; relatedTicketIds?: string[]; customFields?: Record<string, unknown>;
  externalSystem?: string | null; externalId?: string | null; externalUrl?: string | null; resolution?: string;
}

const label = (s: string) => s.replace(/_/g, " ");

export async function updateTicket(orgId: string, id: string, input: TicketUpdateInput, actor: Actor): Promise<{ ticket: Ticket; changes: string[] }> {
  const db = await getDb();
  const current = await loadTicket(id, orgId);
  const patch: Partial<Ticket> = {};
  const changes: string[] = [];
  const events: string[] = [];
  const now = new Date();

  if (input.title !== undefined && input.title !== current.title) { patch.title = input.title; changes.push("title"); }
  if (input.description !== undefined && input.description !== current.description) { patch.description = input.description; changes.push("description"); }
  if (input.type !== undefined && input.type !== current.type) { patch.type = input.type; changes.push("type"); }
  if (input.category !== undefined && (input.category || null) !== current.category) { patch.category = input.category || null; changes.push("category"); }
  if (input.tags !== undefined) { const next = [...new Set(input.tags)]; if (JSON.stringify(next) !== JSON.stringify(current.tags)) { patch.tags = next; changes.push("tags"); } }
  if (input.dueAt !== undefined) { const next = input.dueAt ? new Date(input.dueAt) : null; if ((next?.getTime() ?? null) !== (current.dueAt?.getTime() ?? null)) { patch.dueAt = next; changes.push("dueAt"); } }
  if (input.aiSummary !== undefined && input.aiSummary !== current.aiSummary) { patch.aiSummary = input.aiSummary; changes.push("aiSummary"); }
  if (input.satisfactionRating !== undefined && input.satisfactionRating !== current.satisfactionRating) { patch.satisfactionRating = input.satisfactionRating; changes.push("satisfactionRating"); events.push(input.satisfactionRating ? `Requester rated this ticket ${input.satisfactionRating}/5` : "Satisfaction rating cleared"); }
  if (input.externalSystem !== undefined) { patch.externalSystem = input.externalSystem; changes.push("externalSystem"); }
  if (input.externalId !== undefined) { patch.externalId = input.externalId; changes.push("externalId"); }
  if (input.externalUrl !== undefined) { patch.externalUrl = input.externalUrl; changes.push("externalUrl"); }

  if (input.siteId !== undefined && input.siteId !== current.siteId) { if (input.siteId) await assertSite(orgId, input.siteId); patch.siteId = input.siteId; changes.push("site"); }
  if (input.deviceId !== undefined && input.deviceId !== current.deviceId) {
    const device = input.deviceId ? await assertDevice(orgId, input.deviceId) : null;
    patch.deviceId = input.deviceId;
    if (device?.siteId && !current.siteId && patch.siteId === undefined) patch.siteId = device.siteId;
    changes.push("device");
    events.push(device ? `Linked device ${device.name}` : "Device link removed");
  }
  if (input.contactId !== undefined && input.contactId !== current.contactId) { if (input.contactId) await assertContact(orgId, input.contactId); patch.contactId = input.contactId; changes.push("contact"); }
  if (input.assigneeId !== undefined && input.assigneeId !== current.assigneeId) {
    const assignee = input.assigneeId ? await assertAssignee(orgId, input.assigneeId) : null;
    patch.assigneeId = input.assigneeId;
    changes.push("assignee");
    events.push(assignee ? `Assigned to ${assignee.name}` : "Unassigned");
    if (assignee && current.status === "new" && !input.status) Object.assign(patch, transitionStamps(current, "open", now));
  }
  if (input.priority !== undefined && input.priority !== current.priority) {
    patch.priority = input.priority;
    changes.push("priority");
    events.push(`Priority changed from ${current.priority} to ${input.priority}`);
    if (current.slaPolicyId) {
      const [policy] = await db.select().from(schema.slaPolicies).where(eq(schema.slaPolicies.id, current.slaPolicyId));
      const due = slaDueDates(policy ?? null, input.priority, current.createdAt);
      patch.firstResponseDueAt = due.firstResponseDueAt;
      patch.resolveDueAt = due.resolveDueAt;
      patch.slaBreached = isSlaBreached({ status: input.status ?? current.status, firstRespondedAt: current.firstRespondedAt, firstResponseDueAt: due.firstResponseDueAt, resolveDueAt: due.resolveDueAt }, now);
    }
  }
  if (input.status !== undefined && input.status !== current.status) {
    Object.assign(patch, transitionStamps(current, input.status, now));
    changes.push("status");
    events.push(`Status changed from ${label(current.status)} to ${label(input.status)}${input.resolution ? ` — ${input.resolution}` : ""}`);
  } else if (input.resolution && (current.status === "resolved" || current.status === "closed")) {
    events.push(`Resolution: ${input.resolution}`);
  }
  if (input.relatedTicketIds !== undefined) {
    const ids = [...new Set(input.relatedTicketIds.filter((x) => x && x !== id))];
    const found = ids.length ? await db.select({ id: schema.tickets.id }).from(schema.tickets).where(and(eq(schema.tickets.orgId, orgId), inArray(schema.tickets.id, ids))) : [];
    if (found.length !== ids.length) throw new DeskError("One or more related tickets were not found", "not_found");
    patch.customFields = { ...current.customFields, ...(input.customFields ?? {}), relatedTicketIds: ids };
    changes.push("related");
  } else if (input.customFields) {
    patch.customFields = { ...current.customFields, ...input.customFields };
    changes.push("customFields");
  }

  if (!changes.length) return { ticket: current, changes };
  patch.updatedAt = now;
  const [ticket] = await db.update(schema.tickets).set(patch).where(eq(schema.tickets.id, id)).returning();
  for (const e of events) await systemEvent(id, e, actor);
  publish("ticket.updated", ticket, { changes, by: actor.name, previousStatus: current.status });
  if (changes.includes("assignee")) publish("ticket.assigned", ticket, { assigneeId: ticket.assigneeId, by: actor.name });
  return { ticket, changes };
}

export async function deleteTicket(orgId: string, id: string, actor: Actor): Promise<Ticket> {
  const db = await getDb();
  const current = await loadTicket(id, orgId);
  await db.update(schema.alerts).set({ ticketId: null }).where(and(eq(schema.alerts.orgId, orgId), eq(schema.alerts.ticketId, id)));
  await db.delete(schema.tickets).where(eq(schema.tickets.id, id));
  publish("ticket.deleted", current, { by: actor.name });
  return current;
}

/* ================================================================================================= comments */

export async function listComments(orgId: string, ticketId: string, opts: { includeInternal: boolean } = { includeInternal: true }) {
  await loadTicket(ticketId, orgId);
  const db = await getDb();
  return db.select().from(schema.ticketComments).where(and(eq(schema.ticketComments.ticketId, ticketId), opts.includeInternal ? undefined : eq(schema.ticketComments.isInternal, false))).orderBy(asc(schema.ticketComments.createdAt));
}

export async function addComment(orgId: string, ticketId: string, input: { body: string; isInternal?: boolean; attachments?: { id: string; name: string; size: number }[]; authorType?: CommentAuthorType }, actor: Actor) {
  const db = await getDb();
  const current = await loadTicket(ticketId, orgId);
  const authorType: CommentAuthorType = input.authorType ?? (actor.kind === "apikey" ? "ai" : "user");
  const isInternal = !!input.isInternal;
  const [comment] = await db.insert(schema.ticketComments).values({ ticketId, authorType, authorId: actor.id, authorName: actor.name, body: input.body, isInternal, attachments: input.attachments ?? [] }).returning();
  const patch: Partial<Ticket> = { updatedAt: new Date() };
  const technicianReply = !isInternal && (authorType === "user" || authorType === "ai");
  if (technicianReply && !current.firstRespondedAt) patch.firstRespondedAt = new Date();
  if (technicianReply && current.status === "new") Object.assign(patch, transitionStamps(current, "open"));
  // A requester writing back re-opens a ticket that was waiting on them.
  if (authorType === "contact" && current.status === "pending") Object.assign(patch, transitionStamps(current, "open"));
  const [ticket] = await db.update(schema.tickets).set(patch).where(eq(schema.tickets.id, ticketId)).returning();
  publish("ticket.comment.created", ticket, { commentId: comment.id, isInternal, authorType, by: actor.name, preview: input.body.slice(0, 160) });
  if (patch.status) publish("ticket.updated", ticket, { changes: ["status"], by: actor.name, previousStatus: current.status });
  return { comment, ticket };
}

export async function getComment(orgId: string, ticketId: string, commentId: string) {
  await loadTicket(ticketId, orgId);
  const db = await getDb();
  const [c] = await db.select().from(schema.ticketComments).where(and(eq(schema.ticketComments.id, commentId), eq(schema.ticketComments.ticketId, ticketId)));
  if (!c) throw new DeskError("Comment not found", "not_found");
  return c;
}

export async function updateComment(orgId: string, ticketId: string, commentId: string, patch: { body?: string; isInternal?: boolean; attachments?: { id: string; name: string; size: number }[] }, actor: Actor) {
  const existing = await getComment(orgId, ticketId, commentId);
  if (existing.authorType === "system") throw new DeskError("System events cannot be edited", "conflict");
  const db = await getDb();
  const [row] = await db.update(schema.ticketComments).set({ ...patch, updatedAt: new Date() }).where(eq(schema.ticketComments.id, commentId)).returning();
  const ticket = await loadTicket(ticketId, orgId);
  publish("ticket.updated", ticket, { changes: ["comment"], commentId, by: actor.name });
  return row;
}

export async function deleteComment(orgId: string, ticketId: string, commentId: string, actor: Actor) {
  const existing = await getComment(orgId, ticketId, commentId);
  const db = await getDb();
  await db.delete(schema.ticketComments).where(eq(schema.ticketComments.id, commentId));
  const ticket = await loadTicket(ticketId, orgId);
  publish("ticket.updated", ticket, { changes: ["comment"], commentId, deleted: true, by: actor.name });
  return existing;
}

/* ================================================================================================= time entries */

export async function listTimeEntries(orgId: string, ticketId: string) {
  await loadTicket(ticketId, orgId);
  const db = await getDb();
  return db.select({ id: schema.timeEntries.id, ticketId: schema.timeEntries.ticketId, userId: schema.timeEntries.userId, userName: schema.users.name, minutes: schema.timeEntries.minutes, note: schema.timeEntries.note, billable: schema.timeEntries.billable, startedAt: schema.timeEntries.startedAt, createdAt: schema.timeEntries.createdAt })
    .from(schema.timeEntries).leftJoin(schema.users, eq(schema.users.id, schema.timeEntries.userId)).where(eq(schema.timeEntries.ticketId, ticketId)).orderBy(asc(schema.timeEntries.createdAt));
}

export async function addTimeEntry(orgId: string, ticketId: string, input: { minutes: number; note?: string; billable?: boolean; startedAt?: string }, actor: Actor) {
  const current = await loadTicket(ticketId, orgId);
  if (!actor.id) throw new DeskError("Time can only be logged by a signed-in user", "bad_request");
  const db = await getDb();
  const [entry] = await db.insert(schema.timeEntries).values({ orgId, ticketId, userId: actor.id, minutes: input.minutes, note: input.note ?? null, billable: input.billable ?? true, startedAt: input.startedAt ? new Date(input.startedAt) : null }).returning();
  const [ticket] = await db.update(schema.tickets).set({ timeSpentMinutes: current.timeSpentMinutes + input.minutes, updatedAt: new Date() }).where(eq(schema.tickets.id, ticketId)).returning();
  const h = Math.floor(input.minutes / 60), m = input.minutes % 60;
  await systemEvent(ticketId, `Logged ${h ? `${h}h ` : ""}${m ? `${m}m` : ""}`.trim() + (input.billable === false ? " (non-billable)" : "") + (input.note ? ` — ${input.note}` : ""), actor);
  publish("ticket.time.logged", ticket, { entryId: entry.id, minutes: input.minutes, billable: entry.billable, by: actor.name, timeSpentMinutes: ticket.timeSpentMinutes });
  return { entry, ticket };
}

export async function deleteTimeEntry(orgId: string, ticketId: string, entryId: string, actor: Actor) {
  const current = await loadTicket(ticketId, orgId);
  const db = await getDb();
  const [entry] = await db.select().from(schema.timeEntries).where(and(eq(schema.timeEntries.id, entryId), eq(schema.timeEntries.ticketId, ticketId), eq(schema.timeEntries.orgId, orgId)));
  if (!entry) throw new DeskError("Time entry not found", "not_found");
  await db.delete(schema.timeEntries).where(eq(schema.timeEntries.id, entryId));
  const [ticket] = await db.update(schema.tickets).set({ timeSpentMinutes: Math.max(0, current.timeSpentMinutes - entry.minutes), updatedAt: new Date() }).where(eq(schema.tickets.id, ticketId)).returning();
  publish("ticket.updated", ticket, { changes: ["time"], by: actor.name, timeSpentMinutes: ticket.timeSpentMinutes });
  return entry;
}

/* ================================================================================================= bulk */

export interface BulkInput { ids: string[]; action: "assign" | "status" | "priority" | "tag" | "untag" | "type" | "delete"; assigneeId?: string | null; status?: TicketStatus; priority?: TicketPriority; type?: TicketType; tag?: string }

export async function bulkTickets(orgId: string, input: BulkInput, actor: Actor, siteIds?: string[]) {
  const db = await getDb();
  const rows = await db.select({ id: schema.tickets.id, tags: schema.tickets.tags, siteId: schema.tickets.siteId, deviceSiteId: schema.devices.siteId }).from(schema.tickets).leftJoin(schema.devices, eq(schema.devices.id, schema.tickets.deviceId)).where(and(eq(schema.tickets.orgId, orgId), inArray(schema.tickets.id, input.ids)));
  const visible = siteIds?.length ? rows.filter((r) => (r.siteId && siteIds.includes(r.siteId)) || (r.deviceSiteId && siteIds.includes(r.deviceSiteId))) : rows;
  const updated: string[] = [];
  const failed: { id: string; error: string }[] = [];
  for (const row of visible) {
    try {
      if (input.action === "delete") { await deleteTicket(orgId, row.id, actor); updated.push(row.id); continue; }
      const patch: TicketUpdateInput =
        input.action === "assign" ? { assigneeId: input.assigneeId ?? null }
        : input.action === "status" ? { status: input.status }
        : input.action === "priority" ? { priority: input.priority }
        : input.action === "type" ? { type: input.type }
        : input.action === "tag" ? { tags: [...new Set([...(row.tags ?? []), input.tag!])] }
        : { tags: (row.tags ?? []).filter((t) => t !== input.tag) };
      await updateTicket(orgId, row.id, patch, actor);
      updated.push(row.id);
    } catch (err) {
      failed.push({ id: row.id, error: err instanceof Error ? err.message : String(err) });
    }
  }
  return { updated: updated.length, ids: updated, failed, skipped: input.ids.length - visible.length };
}

/* ================================================================================================= assignees */

export async function listAssignees(orgId: string) {
  const db = await getDb();
  const u = schema.users, m = schema.memberships;
  return db.select({
    id: u.id, name: u.name, email: u.email, avatarUrl: u.avatarUrl, roleName: schema.roles.name,
    openTickets: sql<number>`(select count(*)::int from ${schema.tickets} t where t.assignee_id = ${u}."id" and t.org_id = ${orgId} and t.status in ('new','open','pending','on_hold'))`,
  }).from(m).innerJoin(u, eq(u.id, m.userId)).innerJoin(schema.roles, eq(schema.roles.id, m.roleId)).where(and(eq(m.orgId, orgId), eq(u.status, "active"))).orderBy(asc(u.name));
}

/* ================================================================================================= SLA sweep */

/** Flag tickets past an SLA target (called by the tickets module on the leader node). Returns the number flagged. */
export async function sweepSlaBreaches(now = new Date()): Promise<number> {
  const db = await getDb();
  const t = schema.tickets;
  const rows = await db.update(t).set({ slaBreached: true, updatedAt: now })
    .where(and(eq(t.slaBreached, false), inArray(t.status, SLA_RUNNING_STATUSES), or(and(isNull(t.firstRespondedAt), sql`${t.firstResponseDueAt} < ${now}`), sql`${t.resolveDueAt} < ${now}`)))
    .returning({ id: t.id, orgId: t.orgId, deviceId: t.deviceId, status: t.status, priority: t.priority, number: t.number, title: t.title, firstRespondedAt: t.firstRespondedAt, firstResponseDueAt: t.firstResponseDueAt, resolveDueAt: t.resolveDueAt });
  for (const r of rows) {
    const target = !r.firstRespondedAt && r.firstResponseDueAt && r.firstResponseDueAt.getTime() < now.getTime() ? "first response" : "resolution";
    await systemEvent(r.id, `SLA breached: ${target} target missed`);
    publish("ticket.sla_breached", r, { target });
  }
  return rows.length;
}
