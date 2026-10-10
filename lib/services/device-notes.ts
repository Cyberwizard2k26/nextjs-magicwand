/**
 * Technician notes on a device (table device_notes). Pinned notes float to the top of the Access console's
 * Notes panel and are the first thing the AI operator reads about a machine.
 * Plain errors / null returns only: no Next.js imports here.
 */
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { getDb, schema } from "../db";
import { bus } from "../bus";

export type DeviceNoteRow = typeof schema.deviceNotes.$inferSelect;
export type NoteActor = { id: string | null; name: string | null };

export async function listDeviceNotes(deviceId: string, opts: { pinned?: boolean; limit?: number } = {}) {
  const db = await getDb();
  const where = [eq(schema.deviceNotes.deviceId, deviceId)];
  if (opts.pinned !== undefined) where.push(eq(schema.deviceNotes.pinned, opts.pinned));
  const items = await db
    .select()
    .from(schema.deviceNotes)
    .where(and(...where))
    .orderBy(desc(schema.deviceNotes.pinned), desc(schema.deviceNotes.createdAt), asc(schema.deviceNotes.id))
    .limit(Math.min(opts.limit ?? 200, 500));
  const [counts] = await db
    .select({ total: sql<number>`count(*)::int`, pinned: sql<number>`count(*) filter (where ${schema.deviceNotes.pinned})::int` })
    .from(schema.deviceNotes)
    .where(eq(schema.deviceNotes.deviceId, deviceId));
  return { items, total: counts?.total ?? items.length, pinned: counts?.pinned ?? 0 };
}

export async function getDeviceNote(deviceId: string, noteId: string): Promise<DeviceNoteRow | null> {
  const db = await getDb();
  const [row] = await db.select().from(schema.deviceNotes).where(and(eq(schema.deviceNotes.id, noteId), eq(schema.deviceNotes.deviceId, deviceId)));
  return row ?? null;
}

export async function createDeviceNote(orgId: string, deviceId: string, actor: NoteActor, input: { body: string; pinned?: boolean }) {
  const db = await getDb();
  const [row] = await db.insert(schema.deviceNotes).values({ deviceId, authorId: actor.id, authorName: actor.name, body: input.body, pinned: input.pinned ?? false }).returning();
  bus.publish("device.note.created", { deviceId, noteId: row.id, pinned: row.pinned, by: actor.name }, { orgId, deviceId });
  return row;
}

export async function updateDeviceNote(orgId: string, deviceId: string, noteId: string, patch: { body?: string; pinned?: boolean }, actor: NoteActor) {
  const db = await getDb();
  const set: Partial<typeof schema.deviceNotes.$inferInsert> = { updatedAt: new Date() };
  if (patch.body !== undefined) set.body = patch.body;
  if (patch.pinned !== undefined) set.pinned = patch.pinned;
  const [row] = await db.update(schema.deviceNotes).set(set).where(and(eq(schema.deviceNotes.id, noteId), eq(schema.deviceNotes.deviceId, deviceId))).returning();
  if (!row) return null;
  bus.publish("device.note.updated", { deviceId, noteId: row.id, pinned: row.pinned, by: actor.name }, { orgId, deviceId });
  return row;
}

export async function deleteDeviceNote(orgId: string, deviceId: string, noteId: string, actor: NoteActor) {
  const db = await getDb();
  const [row] = await db.delete(schema.deviceNotes).where(and(eq(schema.deviceNotes.id, noteId), eq(schema.deviceNotes.deviceId, deviceId))).returning();
  if (!row) return null;
  bus.publish("device.note.deleted", { deviceId, noteId: row.id, by: actor.name }, { orgId, deviceId });
  return row;
}
