import { z } from "zod";
import { api, errors } from "@/lib/api/route";
import { can } from "@/lib/auth/session";
import { requireDevice } from "@/lib/services/device-access";
import { listSessions, openTerminalSession } from "@/lib/services/remote-sessions";

export const dynamic = "force-dynamic";

const Body = z.object({
  type: z.literal("terminal").default("terminal"),
  shell: z.enum(["auto", "bash", "zsh", "sh", "fish", "powershell", "pwsh", "cmd"]).default("auto"),
  runAs: z.enum(["system", "user"]).default("system"),
  cols: z.number().int().min(20).max(500).default(120),
  rows: z.number().int().min(5).max(200).default(32),
});

/** Open an interactive terminal on the device. The browser then attaches over /ws with the returned id. */
export const POST = api({ permission: "remote.terminal", body: Body }, async ({ orgId, params, body, principal, ip, audit }) => {
  const device = await requireDevice(principal, orgId, params.id);
  if (!principal.user) throw errors.forbidden("Terminal sessions need a signed-in user");
  if (body.runAs === "user" && !can(principal, "remote.desktop_control", orgId)) throw errors.forbidden("Running a terminal as the signed-in user requires the \"remote.desktop_control\" permission");
  const result = await openTerminalSession({ device, user: { id: principal.user.id, name: principal.user.name, email: principal.user.email }, ip, shell: body.shell, runAs: body.runAs, cols: body.cols, rows: body.rows });
  await audit("session.terminal.opened", { type: "device", id: device.id, name: device.name }, { sessionId: result.id, shell: body.shell, runAs: body.runAs });
  return { sessionId: result.id, shell: result.shell };
});

export const GET = api({ permission: "remote.terminal" }, async ({ orgId, params, principal }) => {
  const device = await requireDevice(principal, orgId, params.id);
  return listSessions(orgId, { deviceId: device.id, page: 1, pageSize: 50 });
});
