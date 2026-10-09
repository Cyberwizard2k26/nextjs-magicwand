import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { api } from "@/lib/api/route";
import { getDb, schema } from "@/lib/db";

export const dynamic = "force-dynamic";

export const GET = api({ orgOptional: true }, async ({ principal }) => {
  if (!principal.user) return { items: [], unread: 0 };
  const db = await getDb();
  const items = await db.select().from(schema.inboxNotifications).where(eq(schema.inboxNotifications.userId, principal.user.id)).orderBy(desc(schema.inboxNotifications.createdAt)).limit(30);
  const [{ unread }] = await db.select({ unread: sql<number>`count(*)::int` }).from(schema.inboxNotifications).where(and(eq(schema.inboxNotifications.userId, principal.user.id), isNull(schema.inboxNotifications.readAt)));
  return { items, unread };
});
