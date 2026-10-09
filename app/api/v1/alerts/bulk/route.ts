import { z } from "zod";
import { api, errors } from "@/lib/api/route";
import { acknowledgeAlerts, reopenAlerts, resolveAlerts, snoozeAlerts } from "@/lib/services/alerts";

export const dynamic = "force-dynamic";

const Body = z.object({
  action: z.enum(["acknowledge", "resolve", "snooze", "reopen"]),
  ids: z.array(z.string()).min(1).max(500),
  resolution: z.string().max(2000).optional(),
  /** Snooze duration in minutes. */
  minutes: z.number().int().min(5).max(60 * 24 * 30).optional(),
});

/** Acknowledge / resolve / snooze / reopen one or many alerts. */
export const POST = api({ permission: "alerts.manage", body: Body }, async ({ orgId, body, principal, audit }) => {
  const actor = { id: principal.user?.id ?? null, name: principal.user?.name ?? principal.user?.email ?? principal.apiKey?.name ?? null };
  let rows;
  switch (body.action) {
    case "acknowledge": rows = await acknowledgeAlerts(orgId, body.ids, actor); break;
    case "resolve": rows = await resolveAlerts(orgId, body.ids, actor, body.resolution); break;
    case "snooze": {
      if (!body.minutes) throw errors.badRequest("minutes is required to snooze");
      rows = await snoozeAlerts(orgId, body.ids, new Date(Date.now() + body.minutes * 60_000), actor);
      break;
    }
    case "reopen": rows = await reopenAlerts(orgId, body.ids); break;
  }
  await audit(`alert.${body.action}`, { type: "alert", id: body.ids.length === 1 ? body.ids[0] : undefined }, { count: rows.length, ids: body.ids.slice(0, 50), minutes: body.minutes });
  return { updated: rows.length, items: rows };
});
