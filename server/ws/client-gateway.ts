/**
 * Browser WebSocket gateway (/ws). Authenticates with the session cookie, then serves topic subscriptions
 * and relays binary session streams. Remote session attach/detach is driven by the remote module through
 * `clientHub.attachStream`, triggered by { t:"attach", sessionId, viewerStreamId } messages.
 */
import type { IncomingMessage } from "node:http";
import type { WebSocket } from "ws";
import { resolvePrincipal, clientIp } from "@/lib/auth/session";
import { clientHub, type ClientConnection } from "@/lib/realtime/client-hub";
import { agentRegistry } from "@/lib/realtime/agent-registry";
import { bus } from "@/lib/bus";
import { createLogger } from "@/lib/logger";

const log = createLogger("client-gw");

export async function handleClientSocket(socket: WebSocket, req: IncomingMessage) {
  const ip = clientIp(req.headers, req.socket.remoteAddress);
  const principal = await resolvePrincipal({ cookieHeader: req.headers.cookie, authorization: req.headers.authorization, ip, userAgent: req.headers["user-agent"] || "", touch: false });
  if (!principal || principal.kind !== "user" || !principal.user) {
    socket.close(4401, "unauthorized");
    return;
  }
  const conn: ClientConnection = {
    id: crypto.randomUUID(),
    socket,
    userId: principal.user.id,
    orgIds: new Set(principal.memberships.map((m) => m.orgId)),
    isSuperAdmin: principal.isSuperAdmin,
    topics: new Set([`user:${principal.user.id}`]),
    streams: new Map(),
    connectedAt: new Date(),
  };
  clientHub.add(conn);
  socket.send(JSON.stringify({ t: "ready", clientId: conn.id, serverTime: new Date().toISOString() }));

  socket.on("message", (raw, isBinary) => {
    try {
      if (isBinary) {
        const buf = raw as Buffer;
        const { streamId, payload } = clientHub.decode(new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength));
        const s = conn.streams.get(streamId);
        if (!s) return;
        try { agentRegistry.sendBinary(s.deviceId, s.agentStreamId, payload); } catch { /* device went away; relay will close */ }
        return;
      }
      const msg = JSON.parse(raw.toString()) as { t: string; topics?: string[]; [k: string]: unknown };
      switch (msg.t) {
        case "ping":
          socket.send(JSON.stringify({ t: "pong", serverTime: new Date().toISOString() }));
          break;
        case "sub":
          for (const t of msg.topics ?? []) {
            // Only allow org/device topics the user can access; device topic auth is checked by the module on attach.
            if (t.startsWith("org:") && !conn.isSuperAdmin && !conn.orgIds.has(t.slice(4))) continue;
            conn.topics.add(t);
          }
          break;
        case "unsub":
          for (const t of msg.topics ?? []) conn.topics.delete(t);
          break;
        default:
          // Feature modules (remote sessions, chat...) handle their own client messages via the bus.
          bus.publish("client.message", { clientId: conn.id, userId: conn.userId, msg }, { userId: conn.userId });
      }
    } catch (err) {
      log.debug("client message error", { err: String(err) });
    }
  });
  socket.on("close", () => {
    clientHub.remove(conn);
    bus.publish("client.disconnected", { clientId: conn.id, userId: conn.userId }, { userId: conn.userId });
  });
  socket.on("error", () => clientHub.remove(conn));
}
