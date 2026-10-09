import { and, eq, inArray, sql } from "drizzle-orm";
import { api } from "@/lib/api/route";
import { getDb, schema } from "@/lib/db";
import { siteScope } from "@/lib/services/device-access";

export const dynamic = "force-dynamic";

/** Sites of the active org (limited to the caller's sites for site-scoped memberships), with device counts. */
export const GET = api({ permission: "devices.view" }, async ({ orgId, principal }) => {
  const db = await getDb();
  const scope = siteScope(principal, orgId);
  const items = await db
    .select({ id: schema.sites.id, name: schema.sites.name, timezone: schema.sites.timezone, address: schema.sites.address, deviceCount: sql<number>`(select count(*)::int from ${schema.devices} d where d.site_id = ${schema.sites.id} and d.status <> 'decommissioned')` })
    .from(schema.sites)
    .where(and(eq(schema.sites.orgId, orgId), scope ? inArray(schema.sites.id, scope) : undefined))
    .orderBy(schema.sites.name);
  return { items };
});
