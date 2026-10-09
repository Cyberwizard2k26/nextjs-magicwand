import { z } from "zod";
import { api, errors } from "@/lib/api/route";
import { can } from "@/lib/auth/session";
import { requireDevice } from "@/lib/services/device-access";
import { rpcSpec, auditSafeArgs, RPC_COMMAND_NAMES } from "@/lib/services/device-rpc";
import { agentRegistry } from "@/lib/realtime/agent-registry";
import type { CommandType } from "@/lib/protocol/agent";

export const dynamic = "force-dynamic";

const Body = z.object({ cmd: z.string(), args: z.record(z.string(), z.unknown()).default({}) });

/** Run an allowlisted interactive command on a connected device and return its result. */
export const POST = api({ permission: "devices.view", body: Body }, async ({ orgId, params, body, principal, audit }) => {
  const spec = rpcSpec(body.cmd);
  if (!spec) throw errors.badRequest(`Unknown command. Allowed: ${RPC_COMMAND_NAMES.join(", ")}`);
  if (!can(principal, spec.permission, orgId)) throw errors.forbidden(`This action requires the "${spec.permission}" permission`);
  const parsed = spec.args.safeParse(body.args);
  if (!parsed.success) throw errors.badRequest("Invalid arguments", z.treeifyError(parsed.error));
  const device = await requireDevice(principal, orgId, params.id);
  if (!agentRegistry.isOnline(device.id)) throw errors.offline();
  const args = parsed.data as Record<string, unknown>;
  if (spec.audit) await audit(`device.rpc.${body.cmd}`, { type: "device", id: device.id, name: device.name }, auditSafeArgs(args));
  const result = await agentRegistry.command(device.id, body.cmd as CommandType, args, { timeoutSeconds: spec.timeoutSeconds, runAs: spec.runAs });
  if (!result.ok) throw errors.badRequest(result.error || "Command failed", { stderr: result.stderr });
  return { ok: true, data: result.data ?? null, stdout: result.stdout ?? "", stderr: result.stderr ?? "", exitCode: result.exitCode ?? null, durationMs: result.durationMs ?? null };
});
