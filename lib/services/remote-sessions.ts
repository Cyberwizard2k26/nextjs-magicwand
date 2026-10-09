/**
 * Remote sessions (terminal today; desktop/files later): a session owns one agent stream and any number
 * of attached browser viewers. Frames are relayed verbatim both ways; the server never interprets the
 * terminal bytes, it only accounts for them and enforces who may attach.
 *
 * The live registry lives on globalThis so the custom server (gateways, bus) and the Next.js route
 * handlers in the same process see one instance, like agentRegistry and clientHub.
 */
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { getDb, schema } from "../db";
import { bus } from "../bus";
import { agentRegistry } from "../realtime/agent-registry";
import { clientHub, type ClientConnection } from "../realtime/client-hub";
import { createLogger } from "../logger";
import { addDeviceEvent, type Device } from "./devices";
import type { RemoteSessionType } from "../db/schema/remote";

const log = createLogger("sessions");

/** First byte of every frame inside a terminal stream (mirrored in agent/internal/sessions). */
export const TERM_FRAME = { DATA: 0, RESIZE: 1, CLOSE: 2, READY: 3 } as const;

interface Viewer { conn: ClientConnection; viewerStreamId: number }

export interface LiveSession {
  id: string;
  orgId: string;
  deviceId: string;
  userId: string;
  type: RemoteSessionType;
  agentStreamId: number;
  viewers: Map<string, Viewer>; // key: clientId
  bytesIn: number; // agent -> viewers
  bytesOut: number; // viewers -> agent
  startedAt: number;
  /** Last frames from the agent so a viewer that attaches slightly late still sees the prompt. */
  replay: Uint8Array[];
  replayBytes: number;
  ended: boolean;
}

class SessionRegistry {
  private byId = new Map<string, LiveSession>();
  get(id: string) { return this.byId.get(id); }
  add(s: LiveSession) { this.byId.set(s.id, s); }
  remove(id: string) { this.byId.delete(id); }
  all() { return [...this.byId.values()]; }
  forClient(clientId: string) { return this.all().filter((s) => s.viewers.has(clientId)); }
  forDevice(deviceId: string) { return this.all().filter((s) => s.deviceId === deviceId); }
}
interface G { __mwSessions?: SessionRegistry }
const g = globalThis as unknown as G;
export const liveSessions: SessionRegistry = g.__mwSessions ?? (g.__mwSessions = new SessionRegistry());

const REPLAY_LIMIT = 64 * 1024;

export interface OpenTerminalInput {
  device: Device;
  user: { id: string; name: string | null; email: string };
  ip: string;
  shell?: string;
  runAs?: "system" | "user";
  cols?: number;
  rows?: number;
}

/** Open a terminal session: DB row, agent stream, `session_open` on the agent. Returns the session id. */
export async function openTerminalSession(input: OpenTerminalInput) {
  const { device, user } = input;
  if (!agentRegistry.isLocal(device.id)) {
    // Streams are node-local; a device connected to another node cannot be relayed from here yet.
    throw Object.assign(new Error(agentRegistry.isOnline(device.id) ? "Device is connected to another server node; sessions must be opened there" : `Device ${device.id} is offline`), { name: agentRegistry.isOnline(device.id) ? "Error" : "DeviceOfflineError" });
  }
  const db = await getDb();
  const [row] = await db
    .insert(schema.remoteSessions)
    .values({ orgId: device.orgId, deviceId: device.id, userId: user.id, userName: user.name ?? user.email, type: "terminal", status: "requested", consentRequired: false, consentResult: "not_required", options: { shell: input.shell ?? "auto", runAs: input.runAs ?? "system", cols: input.cols ?? 120, rows: input.rows ?? 32 }, ip: input.ip })
    .returning();
  const live: LiveSession = { id: row.id, orgId: device.orgId, deviceId: device.id, userId: user.id, type: "terminal", agentStreamId: 0, viewers: new Map(), bytesIn: 0, bytesOut: 0, startedAt: Date.now(), replay: [], replayBytes: 0, ended: false };
  live.agentStreamId = agentRegistry.openStream(device.id, (payload) => onAgentFrame(live, payload));
  liveSessions.add(live);
  try {
    const result = await agentRegistry.command(device.id, "session_open", { sessionId: row.id, type: "terminal", streamId: live.agentStreamId, shell: input.shell === "auto" ? "" : input.shell ?? "", cols: input.cols ?? 120, rows: input.rows ?? 32 }, { timeoutSeconds: 20, runAs: input.runAs === "user" ? "user" : undefined });
    if (!result.ok) throw new Error(result.error || "agent refused to open the session");
    await db.update(schema.remoteSessions).set({ status: "active", connectedAt: new Date() }).where(eq(schema.remoteSessions.id, row.id));
    await addDeviceEvent(device.id, device.orgId, { type: "session.terminal.started", message: `Terminal session started by ${user.name ?? user.email} (${input.runAs === "user" ? "as signed-in user" : "as system"})`, source: "user", actorId: user.id, data: { sessionId: row.id } });
    bus.publish("session.started", { sessionId: row.id, type: "terminal", userId: user.id, userName: user.name ?? user.email }, { orgId: device.orgId, deviceId: device.id, userId: user.id });
    return { id: row.id, shell: (result.data as { shell?: string } | undefined)?.shell ?? null };
  } catch (err) {
    await finishSession(live, `failed: ${String((err as Error).message || err)}`, "failed");
    throw err;
  }
}

function onAgentFrame(s: LiveSession, payload: Uint8Array) {
  s.bytesIn += payload.byteLength;
  if (payload[0] === TERM_FRAME.DATA || payload[0] === TERM_FRAME.READY) {
    s.replay.push(payload);
    s.replayBytes += payload.byteLength;
    while (s.replayBytes > REPLAY_LIMIT && s.replay.length > 1) s.replayBytes -= s.replay.shift()!.byteLength;
  }
  for (const v of s.viewers.values()) clientHub.sendFrame(v.conn, v.viewerStreamId, payload);
  if (payload[0] === TERM_FRAME.CLOSE) void finishSession(s, "shell exited", "ended");
}

/** Attach a browser viewer. The viewer's own stream id is what its tab allocated. */
export function attachViewer(sessionId: string, conn: ClientConnection, viewerStreamId: number): LiveSession | null {
  const s = liveSessions.get(sessionId);
  if (!s || s.ended) return null;
  if (s.userId !== conn.userId && !conn.isSuperAdmin) return null;
  s.viewers.set(conn.id, { conn, viewerStreamId });
  clientHub.attachStream(conn, viewerStreamId, s.deviceId, s.agentStreamId, () => detachViewer(sessionId, conn.id));
  for (const frame of s.replay) clientHub.sendFrame(conn, viewerStreamId, frame);
  return s;
}

export function detachViewer(sessionId: string, clientId: string) {
  const s = liveSessions.get(sessionId);
  if (!s) return;
  s.viewers.delete(clientId);
  if (s.viewers.size === 0 && !s.ended) {
    // Nobody is watching: give a reconnecting tab a short grace period, then end the shell.
    setTimeout(() => {
      const still = liveSessions.get(sessionId);
      if (still && still.viewers.size === 0 && !still.ended) void endSession(sessionId, "viewer disconnected");
    }, 15_000).unref();
  }
}

/** Ask the agent to close the shell and finish the record. Safe to call twice. */
export async function endSession(sessionId: string, reason: string) {
  const s = liveSessions.get(sessionId);
  if (!s || s.ended) return false;
  if (agentRegistry.isLocal(s.deviceId)) agentRegistry.command(s.deviceId, "session_close", { sessionId, reason }, { timeoutSeconds: 10 }).catch(() => {});
  await finishSession(s, reason, "ended");
  return true;
}

async function finishSession(s: LiveSession, reason: string, status: "ended" | "failed" | "timeout") {
  if (s.ended) return;
  s.ended = true;
  const closeFrame = new Uint8Array([TERM_FRAME.CLOSE, ...Buffer.from(JSON.stringify({ reason }))]);
  for (const v of s.viewers.values()) {
    clientHub.sendFrame(v.conn, v.viewerStreamId, closeFrame);
    v.conn.streams.delete(v.viewerStreamId);
  }
  s.viewers.clear();
  agentRegistry.closeStream(s.deviceId, s.agentStreamId);
  liveSessions.remove(s.id);
  const db = await getDb();
  await db.update(schema.remoteSessions).set({ status, endedAt: new Date(), endReason: reason, bytesIn: s.bytesIn, bytesOut: s.bytesOut }).where(eq(schema.remoteSessions.id, s.id));
  bus.publish("session.ended", { sessionId: s.id, type: s.type, reason, durationMs: Date.now() - s.startedAt }, { orgId: s.orgId, deviceId: s.deviceId, userId: s.userId });
  log.info("session ended", { sessionId: s.id, reason, bytesIn: s.bytesIn, bytesOut: s.bytesOut });
}

/** Viewer -> agent bytes are relayed by the gateway without passing through here, so the agent reports the total it wrote to the pty when the session ends. */
export function noteViewerBytes(sessionId: string, total: number) {
  const s = liveSessions.get(sessionId);
  if (s && Number.isFinite(total)) s.bytesOut = Math.max(s.bytesOut, Math.floor(total));
}

export async function listSessions(orgId: string, opts: { deviceId?: string; userId?: string; active?: boolean; page: number; pageSize: number }) {
  const db = await getDb();
  const where = [eq(schema.remoteSessions.orgId, orgId)];
  if (opts.deviceId) where.push(eq(schema.remoteSessions.deviceId, opts.deviceId));
  if (opts.userId) where.push(eq(schema.remoteSessions.userId, opts.userId));
  if (opts.active) where.push(inArray(schema.remoteSessions.status, ["requested", "pending_consent", "active"]));
  const [{ total }] = await db.select({ total: sql<number>`count(*)::int` }).from(schema.remoteSessions).where(and(...where));
  const items = await db
    .select({ id: schema.remoteSessions.id, deviceId: schema.remoteSessions.deviceId, userId: schema.remoteSessions.userId, userName: schema.remoteSessions.userName, type: schema.remoteSessions.type, status: schema.remoteSessions.status, options: schema.remoteSessions.options, startedAt: schema.remoteSessions.startedAt, connectedAt: schema.remoteSessions.connectedAt, endedAt: schema.remoteSessions.endedAt, endReason: schema.remoteSessions.endReason, bytesIn: schema.remoteSessions.bytesIn, bytesOut: schema.remoteSessions.bytesOut, ip: schema.remoteSessions.ip, deviceName: schema.devices.name, platform: schema.devices.platform, deviceStatus: schema.devices.status })
    .from(schema.remoteSessions)
    .leftJoin(schema.devices, eq(schema.devices.id, schema.remoteSessions.deviceId))
    .where(and(...where))
    .orderBy(desc(schema.remoteSessions.startedAt))
    .limit(opts.pageSize)
    .offset((opts.page - 1) * opts.pageSize);
  return { items: items.map((i) => ({ ...i, live: !!liveSessions.get(i.id), viewers: liveSessions.get(i.id)?.viewers.size ?? 0 })), total, page: opts.page, pageSize: opts.pageSize, pages: Math.max(1, Math.ceil(total / opts.pageSize)) };
}
