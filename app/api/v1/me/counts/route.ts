import { and, eq, inArray, sql } from "drizzle-orm";
import { api } from "@/lib/api/route";
import { getDb, schema } from "@/lib/db";

export const dynamic = "force-dynamic";

/** Sidebar badge counts for the active organization. */
export const GET = api({}, async ({ orgId }) => {
  const db = await getDb();
  const [a] = await db.select({ n: sql<number>`count(*)::int` }).from(schema.alerts).where(and(eq(schema.alerts.orgId, orgId), eq(schema.alerts.status, "open")));
  const [t] = await db.select({ n: sql<number>`count(*)::int` }).from(schema.tickets).where(and(eq(schema.tickets.orgId, orgId), inArray(schema.tickets.status, ["new", "open"])));
  const [p] = await db.select({ n: sql<number>`count(*)::int` }).from(schema.devices).where(and(eq(schema.devices.orgId, orgId), eq(schema.devices.status, "pending")));
  return { alerts: a.n, tickets: t.n, pending: p.n };
});
