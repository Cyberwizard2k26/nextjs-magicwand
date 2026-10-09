/**
 * Browser WebSocket hub: pushes live events (device status, alerts, job progress) to the UI and relays
 * remote-session streams between a viewer and an agent.
 *
 * Client protocol (JSON text frames):
 *   -> { t:"sub", topics:["org:<id>", "device:<id>", "job:<id>", "alerts:<orgId>"] }
 *   -> { t:"unsub", topics:[...] }
 *   -> { t:"ping" }
 *   <- { t:"event", name, payload, ts, deviceId?, orgId? }
 *   <- { t:"pong" }
 * Binary frames: [u32 streamId][payload] relayed verbatim to/from the agent for an attached session.
 */
import type { WebSocket } from "ws";
import { bus, type BusEvent } from "../bus";
import { createLogger } from "../logger";
import { decodeStreamFrame, encodeStreamFrame } from "../protocol/agent";

const log = createLogger("clients");

export interface ClientConnection {
  id: string;
  socket: WebSocket;
  userId: string;
  orgIds: Set<string>;
  isSuperAdmin: boolean;
  topics: Set<string>;
  /** Viewer stream id -> relay (set when a remote session is attached). */
  streams: Map<number, { deviceId: string; agentStreamId: number; onClose?: () => void }>;
  connectedAt: Date;
}

/** Topic names an event should be delivered to (derived from the bus event scope). */
function topicsFor(ev: BusEvent): string[] {
  const t: string[] = ["*"];
  if (ev.orgId) t.push(`org:${ev.orgId}`);
  if (ev.deviceId) t.push(`device:${ev.deviceId}`);
  if (ev.userId) t.push(`user:${ev.userId}`);
  const p = ev.payload as Record<string, unknown> | null;
  if (p && typeof p === "object") {
    if (typeof p.jobId === "string") t.push(`job:${p.jobId}`);
    if (typeof p.sessionId === "string") t.push(`session:${p.sessionId}`);
    if (typeof p.ticketId === "string") t.push(`ticket:${p.ticketId}`);
  }
  return t;
}

class ClientHub {
  private clients = new Map<string, ClientConnection>();
  private initialised = false;

  init() {
    if (this.initialised) return;
    this.initialised = true;
    bus.subscribe("*", (ev) => this.fanOut(ev));
  }

  add(c: ClientConnection) {
    this.clients.set(c.id, c);
  }
  remove(c: ClientConnection) {
    for (const [, s] of c.streams) s.onClose?.();
    c.streams.clear();
    this.clients.delete(c.id);
  }
  count() {
    return this.clients.size;
  }
  forUser(userId: string): ClientConnection[] {
    return [...this.clients.values()].filter((c) => c.userId === userId);
  }

  private fanOut(ev: BusEvent) {
    if (ev.name.startsWith("agent.cmd.")) return; // internal plumbing
    const topics = topicsFor(ev);
    const msg = JSON.stringify({ t: "event", name: ev.name, payload: ev.payload, ts: ev.ts, deviceId: ev.deviceId, orgId: ev.orgId });
    for (const c of this.clients.values()) {
      // Authorisation: a client only ever receives events for orgs it belongs to (or everything as super admin).
      if (ev.orgId && !c.isSuperAdmin && !c.orgIds.has(ev.orgId)) continue;
      if (ev.userId && ev.userId !== c.userId && !ev.orgId) continue;
      if (!topics.some((t) => c.topics.has(t))) continue;
      try {
        c.socket.send(msg);
      } catch (err) {
        log.debug("send failed", { err: String(err) });
      }
    }
  }

  /** Push a message to one specific user (all their tabs). */
  sendToUser(userId: string, name: string, payload: unknown) {
    const msg = JSON.stringify({ t: "event", name, payload, ts: new Date().toISOString() });
    for (const c of this.forUser(userId)) {
      try { c.socket.send(msg); } catch { /* ignore */ }
    }
  }

  /** Attach a viewer-side stream: binary frames the browser sends on viewerStreamId go to the agent, and vice versa. */
  attachStream(c: ClientConnection, viewerStreamId: number, deviceId: string, agentStreamId: number, onClose?: () => void) {
    c.streams.set(viewerStreamId, { deviceId, agentStreamId, onClose });
  }
  detachStream(c: ClientConnection, viewerStreamId: number) {
    const s = c.streams.get(viewerStreamId);
    c.streams.delete(viewerStreamId);
    s?.onClose?.();
  }
  /** Deliver a frame from the agent to the viewer (called by session relays). */
  sendFrame(c: ClientConnection, viewerStreamId: number, payload: Uint8Array) {
    try { c.socket.send(encodeStreamFrame(viewerStreamId, payload)); } catch { /* ignore */ }
  }
  /** Decode a frame received from the viewer. */
  decode(frame: Uint8Array) {
    return decodeStreamFrame(frame);
  }
}

interface HubGlobal { __mwClientHub?: ClientHub }
const g = globalThis as unknown as HubGlobal;
export const clientHub: ClientHub = g.__mwClientHub ?? (g.__mwClientHub = new ClientHub());
