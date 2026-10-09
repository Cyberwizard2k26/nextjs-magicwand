/**
 * In-memory registry of agents connected to THIS server node, plus the request/response layer used by
 * every feature module to talk to devices ("send this command, give me the result").
 *
 * Multi-node: presence is mirrored through the bus (`agent.presence`), and commands for a device that is
 * connected elsewhere are forwarded over the bus and answered by the owning node.
 */
import type { WebSocket } from "ws";
import { bus, NODE_ID } from "../bus";
import { createLogger } from "../logger";
import { encodeStreamFrame, type AgentHello, type CommandResult, type CommandType, type ServerMessage } from "../protocol/agent";

const log = createLogger("agents");

export interface PendingCommand {
  resolve: (r: CommandResult) => void;
  reject: (e: Error) => void;
  timer: NodeJS.Timeout;
  onOutput?: (stream: "stdout" | "stderr", data: string) => void;
  stdout: string[];
  stderr: string[];
}

export type StreamHandler = (payload: Uint8Array) => void;

export interface AgentConnection {
  deviceId: string;
  orgId: string;
  agentId: string;
  hello: AgentHello;
  socket: WebSocket;
  ip: string;
  connectedAt: Date;
  lastSeenAt: Date;
  pending: Map<string, PendingCommand>;
  /** Binary stream routing: streamId -> handler (set by remote session relays). */
  streams: Map<number, StreamHandler>;
  nextStreamId: number;
  bytesIn: number;
  bytesOut: number;
}

export interface CommandOptions {
  timeoutSeconds?: number;
  runAs?: "system" | "user" | "elevated_user";
  stream?: boolean;
  onOutput?: (stream: "stdout" | "stderr", data: string) => void;
  /** Use a specific correlation id (e.g. the jobRun id) so results can be matched after a restart. */
  id?: string;
}

export class DeviceOfflineError extends Error {
  constructor(deviceId: string) {
    super(`Device ${deviceId} is offline`);
    this.name = "DeviceOfflineError";
  }
}

class AgentRegistry {
  private byDevice = new Map<string, AgentConnection>();
  /** deviceId -> nodeId for devices connected to other nodes (populated via bus). */
  private remote = new Map<string, string>();
  private remotePending = new Map<string, { resolve: (r: CommandResult) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }>();
  private initialised = false;

  init() {
    if (this.initialised) return;
    this.initialised = true;
    bus.subscribe<{ deviceId: string; node: string; online: boolean }>("agent.presence", (ev) => {
      if (ev.node === NODE_ID) return;
      if (ev.payload.online) this.remote.set(ev.payload.deviceId, ev.payload.node);
      else if (this.remote.get(ev.payload.deviceId) === ev.payload.node) this.remote.delete(ev.payload.deviceId);
    });
    bus.subscribe<{ node: string; deviceId: string; cmd: CommandType; args: Record<string, unknown>; opts: CommandOptions; reqId: string }>("agent.cmd.forward", async (ev) => {
      if (ev.payload.node !== NODE_ID) return;
      try {
        const result = await this.command(ev.payload.deviceId, ev.payload.cmd, ev.payload.args, ev.payload.opts);
        bus.publish("agent.cmd.forward.result", { reqId: ev.payload.reqId, result });
      } catch (err) {
        bus.publish("agent.cmd.forward.result", { reqId: ev.payload.reqId, error: String(err) });
      }
    });
    bus.subscribe<{ reqId: string; result?: CommandResult; error?: string }>("agent.cmd.forward.result", (ev) => {
      const p = this.remotePending.get(ev.payload.reqId);
      if (!p) return;
      this.remotePending.delete(ev.payload.reqId);
      clearTimeout(p.timer);
      if (ev.payload.result) p.resolve(ev.payload.result);
      else p.reject(new Error(ev.payload.error || "forwarded command failed"));
    });
  }

  add(conn: AgentConnection) {
    const existing = this.byDevice.get(conn.deviceId);
    if (existing && existing.socket !== conn.socket) {
      log.info("replacing duplicate agent connection", { deviceId: conn.deviceId });
      try { existing.socket.close(4001, "replaced by newer connection"); } catch { /* ignore */ }
      this.failPending(existing, new Error("connection replaced"));
    }
    this.byDevice.set(conn.deviceId, conn);
    bus.publish("agent.presence", { deviceId: conn.deviceId, node: NODE_ID, online: true }, { orgId: conn.orgId, deviceId: conn.deviceId });
  }

  remove(conn: AgentConnection) {
    if (this.byDevice.get(conn.deviceId) !== conn) return;
    this.byDevice.delete(conn.deviceId);
    this.failPending(conn, new DeviceOfflineError(conn.deviceId));
    bus.publish("agent.presence", { deviceId: conn.deviceId, node: NODE_ID, online: false }, { orgId: conn.orgId, deviceId: conn.deviceId });
  }

  private failPending(conn: AgentConnection, err: Error) {
    for (const [, p] of conn.pending) {
      clearTimeout(p.timer);
      p.reject(err);
    }
    conn.pending.clear();
  }

  get(deviceId: string): AgentConnection | undefined {
    return this.byDevice.get(deviceId);
  }
  isOnline(deviceId: string): boolean {
    return this.byDevice.has(deviceId) || this.remote.has(deviceId);
  }
  isLocal(deviceId: string): boolean {
    return this.byDevice.has(deviceId);
  }
  localConnections(): AgentConnection[] {
    return [...this.byDevice.values()];
  }
  localCount(): number {
    return this.byDevice.size;
  }

  /** Send a raw protocol message. Throws if the device is not connected to this node. */
  send(deviceId: string, msg: ServerMessage) {
    const conn = this.byDevice.get(deviceId);
    if (!conn) throw new DeviceOfflineError(deviceId);
    const data = JSON.stringify(msg);
    conn.bytesOut += data.length;
    conn.socket.send(data);
  }

  sendBinary(deviceId: string, streamId: number, payload: Uint8Array) {
    const conn = this.byDevice.get(deviceId);
    if (!conn) throw new DeviceOfflineError(deviceId);
    const frame = encodeStreamFrame(streamId, payload);
    conn.bytesOut += frame.byteLength;
    conn.socket.send(frame);
  }

  /** Allocate a stream id on a connection and register its handler for inbound binary frames. */
  openStream(deviceId: string, handler: StreamHandler): number {
    const conn = this.byDevice.get(deviceId);
    if (!conn) throw new DeviceOfflineError(deviceId);
    const id = conn.nextStreamId++;
    conn.streams.set(id, handler);
    return id;
  }
  closeStream(deviceId: string, streamId: number) {
    this.byDevice.get(deviceId)?.streams.delete(streamId);
  }

  /** Send a command and wait for its result. Forwards to the owning node when the device is connected elsewhere. */
  command(deviceId: string, cmd: CommandType, args: Record<string, unknown> = {}, opts: CommandOptions = {}): Promise<CommandResult> {
    const conn = this.byDevice.get(deviceId);
    if (!conn) {
      const node = this.remote.get(deviceId);
      if (!node) return Promise.reject(new DeviceOfflineError(deviceId));
      return new Promise((resolve, reject) => {
        const reqId = crypto.randomUUID();
        const timer = setTimeout(() => {
          this.remotePending.delete(reqId);
          reject(new Error("forwarded command timed out"));
        }, ((opts.timeoutSeconds ?? 120) + 10) * 1000);
        this.remotePending.set(reqId, { resolve, reject, timer });
        const { onOutput: _omit, ...plainOpts } = opts;
        void _omit;
        bus.publish("agent.cmd.forward", { node, deviceId, cmd, args, opts: plainOpts, reqId });
      });
    }
    const id = opts.id ?? crypto.randomUUID();
    const timeoutSeconds = opts.timeoutSeconds ?? 120;
    return new Promise<CommandResult>((resolve, reject) => {
      const timer = setTimeout(() => {
        conn.pending.delete(id);
        reject(new Error(`Command ${cmd} timed out after ${timeoutSeconds}s`));
      }, timeoutSeconds * 1000);
      conn.pending.set(id, { resolve, reject, timer, onOutput: opts.onOutput, stdout: [], stderr: [] });
      try {
        this.send(deviceId, { t: "cmd", id, cmd, args, timeoutSeconds, runAs: opts.runAs, stream: opts.stream ?? Boolean(opts.onOutput) });
      } catch (err) {
        clearTimeout(timer);
        conn.pending.delete(id);
        reject(err as Error);
      }
    });
  }

  /** Called by the gateway when an `output` chunk arrives. */
  handleOutput(conn: AgentConnection, id: string, stream: "stdout" | "stderr", data: string) {
    const p = conn.pending.get(id);
    if (!p) return;
    (stream === "stdout" ? p.stdout : p.stderr).push(data);
    p.onOutput?.(stream, data);
  }

  /** Called by the gateway when a `result` arrives. Returns true when a local waiter consumed it. */
  handleResult(conn: AgentConnection, result: CommandResult): boolean {
    const p = conn.pending.get(result.id);
    if (!p) return false;
    conn.pending.delete(result.id);
    clearTimeout(p.timer);
    if (result.stdout === undefined && p.stdout.length) result.stdout = p.stdout.join("");
    if (result.stderr === undefined && p.stderr.length) result.stderr = p.stderr.join("");
    p.resolve(result);
    return true;
  }

  /** Route an inbound binary frame to its stream handler. */
  handleBinary(conn: AgentConnection, streamId: number, payload: Uint8Array) {
    const h = conn.streams.get(streamId);
    if (h) h(payload);
  }
}

interface RegistryGlobal { __mwAgentRegistry?: AgentRegistry }
const g = globalThis as unknown as RegistryGlobal;
export const agentRegistry: AgentRegistry = g.__mwAgentRegistry ?? (g.__mwAgentRegistry = new AgentRegistry());
