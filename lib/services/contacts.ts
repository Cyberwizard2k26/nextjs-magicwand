/**
 * Contacts (end users): who sits behind a ticket, which devices they use. Plain Drizzle functions; routes translate
 * DeskError codes to HTTP errors. Events: contact.created | contact.updated | contact.deleted | contact.device.linked | contact.device.unlinked
 */
import { and, asc, desc, eq, ilike, inArray, or, sql, type SQL } from "drizzle-orm";
import { getDb, schema } from "../db";
import { bus } from "../bus";
import { DeskError } from "./tickets";

export type Contact = typeof schema.contacts.$inferSelect;
export type PublicContact = Omit<Contact, "portalPasswordHash">;

/** Never hand the portal password hash to callers. */
export function publicContact(row: Contact): PublicContact {
  const { portalPasswordHash: _hash, ...rest } = row;
  void _hash;
  return rest;
}

export interface ContactListParams { orgId: string; siteIds?: string[]; q?: string; siteId?: string; deviceId?: string; isVip?: boolean; portalEnabled?: boolean; sort?: string; dir?: "asc" | "desc"; page: number; pageSize: number }

const c = schema.contacts;
const openTicketsSql = sql<number>`(select count(*)::int from ${schema.tickets} t where t.contact_id = ${c}."id" and t.status in ('new','open','pending','on_hold'))`;
const deviceCountSql = sql<number>`(select count(*)::int from ${schema.contactDevices} cd where cd.contact_id = ${c}."id")`;
const primaryDeviceIdSql = sql<string | null>`(select cd.device_id from ${schema.contactDevices} cd where cd.contact_id = ${c}."id" order by cd.is_primary desc limit 1)`;
const primaryDeviceNameSql = sql<string | null>`(select d.name from ${schema.contactDevices} cd join ${schema.devices} d on d.id = cd.device_id where cd.contact_id = ${c}."id" order by cd.is_primary desc limit 1)`;

const rowSelect = {
  id: c.id, name: c.name, email: c.email, phone: c.phone, title: c.title, department: c.department, siteId: c.siteId, siteName: schema.sites.name, isVip: c.isVip, portalEnabled: c.portalEnabled, notes: c.notes,
  deviceCount: deviceCountSql, openTickets: openTicketsSql, primaryDeviceId: primaryDeviceIdSql, primaryDeviceName: primaryDeviceNameSql, createdAt: c.createdAt, updatedAt: c.updatedAt,
};

export async function listContacts(p: ContactListParams) {
  const db = await getDb();
  const where: SQL[] = [eq(c.orgId, p.orgId)];
  if (p.siteIds?.length) where.push(inArray(c.siteId, p.siteIds));
  if (p.siteId) where.push(eq(c.siteId, p.siteId));
  if (p.isVip !== undefined) where.push(eq(c.isVip, p.isVip));
  if (p.portalEnabled !== undefined) where.push(eq(c.portalEnabled, p.portalEnabled));
  if (p.deviceId) where.push(sql`exists (select 1 from ${schema.contactDevices} cd where cd.contact_id = ${c}."id" and cd.device_id = ${p.deviceId})`);
  if (p.q?.trim()) {
    const like = `%${p.q.trim().replace(/[%_]/g, "\\$&")}%`;
    where.push(or(ilike(c.name, like), ilike(c.email, like), ilike(c.phone, like), ilike(c.department, like), ilike(c.title, like))!);
  }
  const order = p.sort === "email" ? [p.dir === "desc" ? desc(c.email) : asc(c.email)] : p.sort === "createdAt" ? [p.dir === "asc" ? asc(c.createdAt) : desc(c.createdAt)] : p.sort === "updatedAt" ? [p.dir === "asc" ? asc(c.updatedAt) : desc(c.updatedAt)] : p.sort === "openTickets" ? [p.dir === "asc" ? asc(openTicketsSql) : desc(openTicketsSql)] : [p.dir === "desc" ? desc(c.name) : asc(c.name)];
  const [{ total }] = await db.select({ total: sql<number>`count(*)::int` }).from(c).where(and(...where));
  const items = await db.select(rowSelect).from(c).leftJoin(schema.sites, eq(schema.sites.id, c.siteId)).where(and(...where)).orderBy(...order).limit(p.pageSize).offset((p.page - 1) * p.pageSize);
  return { items, total, page: p.page, pageSize: p.pageSize, pages: Math.max(1, Math.ceil(total / p.pageSize)) };
}
export type ContactRow = Awaited<ReturnType<typeof listContacts>>["items"][number];

export async function getContact(id: string, orgId: string, siteIds?: string[]) {
  const db = await getDb();
  const [row] = await db.select({ ...rowSelect, customFields: c.customFields }).from(c).leftJoin(schema.sites, eq(schema.sites.id, c.siteId)).where(and(eq(c.id, id), eq(c.orgId, orgId)));
  if (!row) return null;
  if (siteIds?.length && !(row.siteId && siteIds.includes(row.siteId))) return null;
  const [devices, tickets, [stats]] = await Promise.all([
    db.select({ id: schema.devices.id, name: schema.devices.name, platform: schema.devices.platform, status: schema.devices.status, loggedInUser: schema.devices.loggedInUser, lastSeenAt: schema.devices.lastSeenAt, isPrimary: schema.contactDevices.isPrimary })
      .from(schema.contactDevices).innerJoin(schema.devices, eq(schema.devices.id, schema.contactDevices.deviceId)).where(eq(schema.contactDevices.contactId, id)).orderBy(desc(schema.contactDevices.isPrimary), asc(schema.devices.name)),
    db.select({ id: schema.tickets.id, number: schema.tickets.number, title: schema.tickets.title, status: schema.tickets.status, priority: schema.tickets.priority, updatedAt: schema.tickets.updatedAt }).from(schema.tickets).where(eq(schema.tickets.contactId, id)).orderBy(desc(schema.tickets.updatedAt)).limit(25),
    db.select({ openTickets: sql<number>`count(*) filter (where ${schema.tickets.status} in ('new','open','pending','on_hold'))::int`, totalTickets: sql<number>`count(*)::int`, avgSatisfaction: sql<number | null>`round(avg(${schema.tickets.satisfactionRating})::numeric, 1)::float` }).from(schema.tickets).where(eq(schema.tickets.contactId, id)),
  ]);
  return { contact: row, devices, tickets, stats };
}

async function assertSite(orgId: string, siteId: string) {
  const db = await getDb();
  const [s] = await db.select({ id: schema.sites.id }).from(schema.sites).where(and(eq(schema.sites.id, siteId), eq(schema.sites.orgId, orgId)));
  if (!s) throw new DeskError("Site not found", "not_found");
}
async function assertDevices(orgId: string, deviceIds: string[]) {
  if (!deviceIds.length) return [];
  const db = await getDb();
  const rows = await db.select({ id: schema.devices.id, name: schema.devices.name, siteId: schema.devices.siteId }).from(schema.devices).where(and(eq(schema.devices.orgId, orgId), inArray(schema.devices.id, deviceIds)));
  if (rows.length !== new Set(deviceIds).size) throw new DeskError("One or more devices were not found", "not_found");
  return rows;
}

export interface ContactInput { name: string; email?: string | null; phone?: string | null; title?: string | null; department?: string | null; siteId?: string | null; isVip?: boolean; portalEnabled?: boolean; notes?: string | null; customFields?: Record<string, unknown> }

export async function createContact(orgId: string, input: ContactInput & { deviceIds?: string[]; primaryDeviceId?: string }, actor: { id: string | null; name: string | null }) {
  const db = await getDb();
  if (input.siteId) await assertSite(orgId, input.siteId);
  const devices = await assertDevices(orgId, input.deviceIds ?? []);
  if (input.email) {
    const [dup] = await db.select({ id: c.id }).from(c).where(and(eq(c.orgId, orgId), sql`lower(${c.email}) = lower(${input.email})`));
    if (dup) throw new DeskError("A contact with this email already exists", "conflict");
  }
  const [row] = await db.insert(c).values({
    orgId, name: input.name, email: input.email || null, phone: input.phone || null, title: input.title || null, department: input.department || null,
    siteId: input.siteId ?? devices.find((d) => d.siteId)?.siteId ?? null, isVip: !!input.isVip, portalEnabled: !!input.portalEnabled, notes: input.notes || null, customFields: input.customFields ?? {},
  }).returning();
  if (devices.length) {
    const primary = input.primaryDeviceId && devices.some((d) => d.id === input.primaryDeviceId) ? input.primaryDeviceId : devices[0].id;
    await db.insert(schema.contactDevices).values(devices.map((d) => ({ contactId: row.id, deviceId: d.id, isPrimary: d.id === primary })));
  }
  bus.publish("contact.created", { contactId: row.id, orgId, name: row.name, by: actor.name }, { orgId });
  return publicContact(row);
}

export async function updateContact(orgId: string, id: string, input: Partial<ContactInput>, actor: { id: string | null; name: string | null }) {
  const db = await getDb();
  const [existing] = await db.select().from(c).where(and(eq(c.id, id), eq(c.orgId, orgId)));
  if (!existing) throw new DeskError("Contact not found", "not_found");
  if (input.siteId) await assertSite(orgId, input.siteId);
  if (input.email && input.email.toLowerCase() !== existing.email?.toLowerCase()) {
    const [dup] = await db.select({ id: c.id }).from(c).where(and(eq(c.orgId, orgId), sql`lower(${c.email}) = lower(${input.email})`));
    if (dup && dup.id !== id) throw new DeskError("A contact with this email already exists", "conflict");
  }
  const patch: Partial<Contact> = { updatedAt: new Date() };
  for (const k of ["name", "email", "phone", "title", "department", "siteId", "isVip", "portalEnabled", "notes"] as const) {
    if (input[k] !== undefined) (patch as Record<string, unknown>)[k] = k === "name" ? input.name : k === "isVip" || k === "portalEnabled" ? !!input[k] : input[k] || null;
  }
  if (input.customFields) patch.customFields = { ...existing.customFields, ...input.customFields };
  const [row] = await db.update(c).set(patch).where(eq(c.id, id)).returning();
  bus.publish("contact.updated", { contactId: id, orgId, name: row.name, by: actor.name }, { orgId });
  return publicContact(row);
}

export async function deleteContact(orgId: string, id: string, actor: { id: string | null; name: string | null }) {
  const db = await getDb();
  const [existing] = await db.select().from(c).where(and(eq(c.id, id), eq(c.orgId, orgId)));
  if (!existing) throw new DeskError("Contact not found", "not_found");
  await db.delete(c).where(eq(c.id, id));
  bus.publish("contact.deleted", { contactId: id, orgId, name: existing.name, by: actor.name }, { orgId });
  return publicContact(existing);
}

export async function linkContactDevice(orgId: string, contactId: string, deviceId: string, isPrimary: boolean, actor: { id: string | null; name: string | null }) {
  const db = await getDb();
  const [existing] = await db.select({ id: c.id, name: c.name }).from(c).where(and(eq(c.id, contactId), eq(c.orgId, orgId)));
  if (!existing) throw new DeskError("Contact not found", "not_found");
  const [device] = await assertDevices(orgId, [deviceId]);
  const [count] = await db.select({ n: sql<number>`count(*)::int` }).from(schema.contactDevices).where(eq(schema.contactDevices.contactId, contactId));
  const primary = isPrimary || (count?.n ?? 0) === 0;
  if (primary) await db.update(schema.contactDevices).set({ isPrimary: false }).where(eq(schema.contactDevices.contactId, contactId));
  await db.insert(schema.contactDevices).values({ contactId, deviceId, isPrimary: primary }).onConflictDoUpdate({ target: [schema.contactDevices.contactId, schema.contactDevices.deviceId], set: { isPrimary: primary } });
  bus.publish("contact.device.linked", { contactId, orgId, deviceId, isPrimary: primary, by: actor.name }, { orgId, deviceId });
  return { contactId, deviceId, isPrimary: primary, deviceName: device.name };
}

export async function unlinkContactDevice(orgId: string, contactId: string, deviceId: string, actor: { id: string | null; name: string | null }) {
  const db = await getDb();
  const [existing] = await db.select({ id: c.id }).from(c).where(and(eq(c.id, contactId), eq(c.orgId, orgId)));
  if (!existing) throw new DeskError("Contact not found", "not_found");
  const rows = await db.delete(schema.contactDevices).where(and(eq(schema.contactDevices.contactId, contactId), eq(schema.contactDevices.deviceId, deviceId))).returning();
  if (!rows.length) throw new DeskError("Device is not linked to this contact", "not_found");
  if (rows[0].isPrimary) {
    const [next] = await db.select({ deviceId: schema.contactDevices.deviceId }).from(schema.contactDevices).where(eq(schema.contactDevices.contactId, contactId)).limit(1);
    if (next) await db.update(schema.contactDevices).set({ isPrimary: true }).where(and(eq(schema.contactDevices.contactId, contactId), eq(schema.contactDevices.deviceId, next.deviceId)));
  }
  bus.publish("contact.device.unlinked", { contactId, orgId, deviceId, by: actor.name }, { orgId, deviceId });
  return rows[0];
}

/** Contacts linked to a device (used by device pages and the AI to find who to talk to). */
export async function contactsForDevice(orgId: string, deviceId: string) {
  const db = await getDb();
  return db.select({ id: c.id, name: c.name, email: c.email, phone: c.phone, isVip: c.isVip, isPrimary: schema.contactDevices.isPrimary }).from(schema.contactDevices).innerJoin(c, eq(c.id, schema.contactDevices.contactId)).where(and(eq(schema.contactDevices.deviceId, deviceId), eq(c.orgId, orgId))).orderBy(desc(schema.contactDevices.isPrimary), asc(c.name));
}
