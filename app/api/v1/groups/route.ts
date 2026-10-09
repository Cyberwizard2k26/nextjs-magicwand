import { eq, sql } from "drizzle-orm";
import { api } from "@/lib/api/route";
import { getDb, schema } from "@/lib/db";

export const dynamic = "force-dynamic";

/** Device groups of the active org with member counts (static membership only; dynamic groups resolve at use time). */
export const GET = api({ permission: "devices.view" }, async ({ orgId }) => {
  const db = await getDb();
  const items = await db
    .select({ id: schema.deviceGroups.id, name: schema.deviceGroups.name, description: schema.deviceGroups.description, color: schema.deviceGroups.color, isDynamic: schema.deviceGroups.isDynamic, siteId: schema.deviceGroups.siteId, deviceCount: sql<number>`(select count(*)::int from ${schema.devices} d where d.group_id = ${schema.deviceGroups.id} and d.status <> 'decommissioned')` })
    .from(schema.deviceGroups)
    .where(eq(schema.deviceGroups.orgId, orgId))
    .orderBy(schema.deviceGroups.sortOrder, schema.deviceGroups.name);
  return { items };
});
