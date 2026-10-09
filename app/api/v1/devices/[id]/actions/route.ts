import { z } from "zod";
import { api, errors } from "@/lib/api/route";
import { can } from "@/lib/auth/session";
import type { Permission } from "@/lib/rbac/permissions";
import { requireDevice } from "@/lib/services/device-access";
import { createJob } from "@/lib/services/jobs";
import type { JobType } from "@/lib/db/schema/automation";

export const dynamic = "force-dynamic";

/**
 * Single-device actions. Each one becomes a job (durable, audited, replayable) targeting just this device,
 * so the console history, the timeline and the jobs page all agree on what was done and by whom.
 */
const ACTIONS: Record<string, { type: JobType; permission: Permission; name: (p: Record<string, unknown>) => string; timeoutSeconds?: number }> = {
  command: { type: "command", permission: "scripts.run", name: (p) => `Console: ${String(p.command ?? "").slice(0, 80)}`, timeoutSeconds: 600 },
  script: { type: "script", permission: "scripts.run", name: (p) => `Script: ${String(p.name ?? p.scriptId ?? "ad-hoc")}` },
  reboot: { type: "reboot", permission: "devices.power", name: () => "Reboot" },
  shutdown: { type: "shutdown", permission: "devices.power", name: () => "Shut down" },
  lock_screen: { type: "lock_screen", permission: "devices.power", name: () => "Lock screen" },
  logoff_user: { type: "logoff_user", permission: "devices.power", name: () => "Log off user" },
  inventory: { type: "inventory", permission: "devices.manage", name: () => "Refresh inventory" },
  message_user: { type: "message_user", permission: "remote.tools", name: (p) => `Message: ${String(p.title ?? "").slice(0, 60)}` },
  clear_cache: { type: "clear_cache", permission: "scripts.run", name: () => "Clear temporary files" },
  agent_update: { type: "agent_update", permission: "devices.manage", name: () => "Update agent" },
};

const Body = z.object({
  action: z.string(),
  payload: z.record(z.string(), z.unknown()).default({}),
  timeoutSeconds: z.number().int().positive().max(24 * 3600).optional(),
  /** Queue for later if the device is offline right now (default true, matching jobs). */
  runWhenOnline: z.boolean().optional(),
});

export const POST = api({ permission: "devices.view", body: Body }, async ({ orgId, params, body, principal, audit }) => {
  const spec = ACTIONS[body.action];
  if (!spec) throw errors.badRequest(`Unknown action. Allowed: ${Object.keys(ACTIONS).join(", ")}`);
  if (!can(principal, spec.permission, orgId)) throw errors.forbidden(`This action requires the "${spec.permission}" permission`);
  if (body.action === "command" && !String(body.payload.command ?? "").trim()) throw errors.badRequest("command is required");
  const device = await requireDevice(principal, orgId, params.id);
  const { job, runs } = await createJob({
    orgId,
    type: spec.type,
    name: spec.name(body.payload),
    targetType: "device",
    targetIds: [device.id],
    payload: body.payload,
    source: "manual",
    timeoutSeconds: body.timeoutSeconds ?? spec.timeoutSeconds,
    runWhenOnline: body.runWhenOnline ?? true,
    createdBy: principal.user?.id ?? null,
    createdByName: principal.user?.name ?? principal.user?.email ?? principal.apiKey?.name ?? null,
  });
  await audit(`device.action.${body.action}`, { type: "device", id: device.id, name: device.name }, { jobId: job.id, payload: body.action === "command" ? { command: body.payload.command } : body.payload });
  return { job, run: runs[0] ?? null };
});
