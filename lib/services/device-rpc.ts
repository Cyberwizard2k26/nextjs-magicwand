/**
 * Interactive device RPC ("Backstage" tools): short, synchronous commands a technician runs while looking at
 * a device - process lists, file browsing, network diagnostics. Every command is allowlisted with the
 * permission it needs, an argument schema and whether it is written to the audit log.
 *
 * Long-running or fleet-wide work (scripts, reboots, installs) goes through jobs instead, which are durable
 * and offline-capable - see lib/services/jobs.ts.
 */
import { z, type ZodType } from "zod";
import type { Permission } from "../rbac/permissions";
import type { CommandType } from "../protocol/agent";

export interface RpcSpec {
  permission: Permission;
  args: ZodType;
  timeoutSeconds: number;
  /** Mutating / sensitive: written to the audit log with its arguments. */
  audit: boolean;
  runAs?: "system" | "user";
}

const path = z.string().min(1).max(4096);

export const RPC_COMMANDS = {
  process_list: { permission: "remote.tools", args: z.object({}).passthrough(), timeoutSeconds: 30, audit: false },
  process_kill: { permission: "remote.tools", args: z.object({ pid: z.number().int().positive().optional(), name: z.string().max(256).optional(), force: z.boolean().optional() }), timeoutSeconds: 30, audit: true },
  file_list: { permission: "remote.files", args: z.object({ path: z.string().max(4096).default("") }), timeoutSeconds: 30, audit: false },
  file_read: { permission: "remote.files", args: z.object({ path, maxBytes: z.number().int().positive().max(8 << 20).optional(), offset: z.number().int().nonnegative().optional() }), timeoutSeconds: 60, audit: true },
  file_write: { permission: "remote.files", args: z.object({ path, contentBase64: z.string(), append: z.boolean().optional() }), timeoutSeconds: 120, audit: true },
  file_delete: { permission: "remote.files", args: z.object({ path, recursive: z.boolean().optional() }), timeoutSeconds: 60, audit: true },
  file_mkdir: { permission: "remote.files", args: z.object({ path }), timeoutSeconds: 30, audit: true },
  file_rename: { permission: "remote.files", args: z.object({ from: path, to: path }), timeoutSeconds: 30, audit: true },
  file_hash: { permission: "remote.files", args: z.object({ path }), timeoutSeconds: 300, audit: false },
  file_search: { permission: "remote.files", args: z.object({ root: path, pattern: z.string().min(1).max(256), maxResults: z.number().int().positive().max(2000).optional() }), timeoutSeconds: 120, audit: false },
  ping: { permission: "remote.tools", args: z.object({ host: z.string().min(1).max(253), count: z.number().int().min(1).max(20).optional() }), timeoutSeconds: 60, audit: false },
  port_check: { permission: "remote.tools", args: z.object({ host: z.string().min(1).max(253), port: z.number().int().min(1).max(65535), timeoutMs: z.number().int().positive().max(30000).optional() }), timeoutSeconds: 40, audit: false },
  dns_lookup: { permission: "remote.tools", args: z.object({ name: z.string().min(1).max(253) }), timeoutSeconds: 30, audit: false },
  traceroute: { permission: "remote.tools", args: z.object({ host: z.string().min(1).max(253) }), timeoutSeconds: 120, audit: false },
  telemetry_now: { permission: "devices.view", args: z.object({}), timeoutSeconds: 30, audit: false },
  inventory: { permission: "devices.manage", args: z.object({ full: z.boolean().optional(), sections: z.array(z.string()).optional() }), timeoutSeconds: 600, audit: true },
  agent_logs: { permission: "devices.manage", args: z.object({}), timeoutSeconds: 30, audit: false },
  agent_restart: { permission: "devices.manage", args: z.object({}), timeoutSeconds: 15, audit: true },
  lock: { permission: "devices.power", args: z.object({}), timeoutSeconds: 30, audit: true },
  logoff: { permission: "devices.power", args: z.object({ user: z.string().max(256).optional() }), timeoutSeconds: 60, audit: true },
} as const satisfies Partial<Record<CommandType, RpcSpec>>;

export type RpcCommand = keyof typeof RPC_COMMANDS;
export const RPC_COMMAND_NAMES = Object.keys(RPC_COMMANDS) as RpcCommand[];

export function rpcSpec(cmd: string): RpcSpec | null {
  return (RPC_COMMANDS as Record<string, RpcSpec>)[cmd] ?? null;
}

/** Arguments never worth storing verbatim in the audit log (file contents). */
export function auditSafeArgs(args: Record<string, unknown>): Record<string, unknown> {
  const { contentBase64, ...rest } = args;
  return contentBase64 ? { ...rest, bytes: Math.floor((String(contentBase64).length * 3) / 4) } : rest;
}
