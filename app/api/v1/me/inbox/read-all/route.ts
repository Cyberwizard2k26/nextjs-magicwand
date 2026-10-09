import { and, eq, isNull } from "drizzle-orm";
import { api } from "@/lib/api/route";
import { getDb, schema } from "@/lib/db";

export const dynamic = "force-dynamic";

export const POST = api({ orgOptional: true }, async ({ principal }) => {
  if (!principal.user) return { ok: true };
  const db = await getDb();
  await db.update(schema.inboxNotifications).set({ readAt: new Date() }).where(and(eq(schema.inboxNotifications.userId, principal.user.id), isNull(schema.inboxNotifications.readAt)));
  return { ok: true };
});
