import { z } from "zod";
import { and, inArray } from "drizzle-orm";
import { api } from "@/lib/api/route";
import { getDb, schema } from "@/lib/db";
import { resolveTargets } from "@/lib/services/device-filter";
import { siteScope } from "@/lib/services/device-access";
import { agentRegistry } from "@/lib/realtime/agent-registry";

export const dynamic = "force-dynamic";

const Body = z.object({ targetType: z.enum(["device", "group", "site", "org", "filter"]), targetIds: z.array(z.string()).max(5000).default([]), targetFilter: z.record(z.string(), z.unknown()).nullable().optional() });

/** Resolve a target expression to the devices it would hit (count, online split, a few names) before creating a job. */
export const POST = api({ permission: "jobs.view", body: Body }, async ({ orgId, body, principal }) => {
  let ids = await resolveTargets(orgId, body.targetType, body.targetIds, body.targetFilter ?? null);
  const scope = siteScope(principal, orgId);
  const db = await getDb();
  if (!ids.length) return { total: 0, online: 0, offline: 0, sample: [], byPlatform: {} };
  const rows = await db.select({ id: schema.devices.id, name: schema.devices.name, platform: schema.devices.platform, siteId: schema.devices.siteId }).from(schema.devices).where(and(inArray(schema.devices.id, ids), scope ? inArray(schema.devices.siteId, scope) : undefined));
  ids = rows.map((r) => r.id);
  const online = rows.filter((r) => agentRegistry.isOnline(r.id)).length;
  const byPlatform: Record<string, number> = {};
  for (const r of rows) byPlatform[r.platform] = (byPlatform[r.platform] ?? 0) + 1;
  return { total: ids.length, online, offline: ids.length - online, sample: rows.slice(0, 8).map((r) => r.name), byPlatform };
});
