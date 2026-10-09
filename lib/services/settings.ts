/** Server-wide settings stored in the `settings` table (key/value JSON). */
import { eq } from "drizzle-orm";
import { getDb, schema } from "../db";

const cache = new Map<string, { value: unknown; at: number }>();

export async function getSetting<T = unknown>(key: string, def: T): Promise<T> {
  const c = cache.get(key);
  if (c && Date.now() - c.at < 10_000) return c.value as T;
  const db = await getDb();
  const [row] = await db.select().from(schema.settings).where(eq(schema.settings.key, key));
  const value = row ? (row.value as T) : def;
  cache.set(key, { value, at: Date.now() });
  return value;
}

export async function setSetting(key: string, value: unknown) {
  const db = await getDb();
  await db.insert(schema.settings).values({ key, value }).onConflictDoUpdate({ target: schema.settings.key, set: { value, updatedAt: new Date() } });
  cache.set(key, { value, at: Date.now() });
}
