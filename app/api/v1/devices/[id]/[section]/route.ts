import { z } from "zod";
import { api, errors } from "@/lib/api/route";
import { requireDevice } from "@/lib/services/device-access";
import { deviceJobRuns, deviceLocalUsers, deviceServices, deviceSoftware, deviceTelemetry, deviceTimeline } from "@/lib/services/device-detail";
import { getDb, schema } from "@/lib/db";
import { and, desc, eq } from "drizzle-orm";

export const dynamic = "force-dynamic";

const Query = z.object({
  q: z.string().max(200).optional(),
  range: z.enum(["1h", "6h", "24h", "7d"]).default("1h"),
  before: z.string().datetime({ offset: true }).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});

/** Read-only inventory sections of one device: software | services | users | events | telemetry | timeline | jobs */
export const GET = api({ permission: "devices.view", query: Query }, async ({ orgId, params, query, principal }) => {
  const device = await requireDevice(principal, orgId, params.id);
  switch (params.section) {
    case "software": return { items: await deviceSoftware(device.id, query.q) };
    case "services": return { items: await deviceServices(device.id) };
    case "users": return { items: await deviceLocalUsers(device.id) };
    case "telemetry": return deviceTelemetry(device.id, query.range);
    case "timeline": return { items: await deviceTimeline(device.id, orgId, { before: query.before ? new Date(query.before) : undefined, limit: query.limit }) };
    case "jobs": return { items: await deviceJobRuns(device.id, query.limit ?? 50) };
    case "events": {
      const db = await getDb();
      const items = await db.select().from(schema.deviceEvents).where(and(eq(schema.deviceEvents.deviceId, device.id))).orderBy(desc(schema.deviceEvents.ts)).limit(query.limit ?? 100);
      return { items };
    }
    default: throw errors.notFound("Unknown section");
  }
});
