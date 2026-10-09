import type { FeatureModule } from "@/lib/services/registry";
import { bus } from "@/lib/bus";
import { clientHub } from "@/lib/realtime/client-hub";
import { attachViewer, detachViewer, endSession, liveSessions, noteViewerBytes } from "@/lib/services/remote-sessions";
import { getDb, schema } from "@/lib/db";
import { eq } from "drizzle-orm";
import { createLogger } from "@/lib/logger";

const log = createLogger("remote");

/**
 * remote module: wires browser attach/detach requests and agent session events to the session registry.
 *   browser -> { t:"attach", sessionId, viewerStreamId }  (answered with { t:"attached"|"attach_failed", sessionId })
 *   browser -> { t:"detach", sessionId }
 */
const mod: FeatureModule = {
  name: "remote",
  register() {
    bus.subscribe<{ clientId: string; userId: string; msg: { t: string; sessionId?: string; viewerStreamId?: number } }>("client.message", (ev) => {
      const { clientId, userId, msg } = ev.payload;
      if (msg.t !== "attach" && msg.t !== "detach") return;
      const conn = clientHub.forUser(userId).find((c) => c.id === clientId);
      if (!conn || !msg.sessionId) return;
      if (msg.t === "detach") { detachViewer(msg.sessionId, clientId); return; }
      const s = attachViewer(msg.sessionId, conn, Number(msg.viewerStreamId));
      try { conn.socket.send(JSON.stringify({ t: s ? "attached" : "attach_failed", sessionId: msg.sessionId })); } catch { /* ignore */ }
      if (!s) log.warn("attach refused", { sessionId: msg.sessionId, userId });
    });
    bus.subscribe<{ clientId: string }>("client.disconnected", (ev) => {
      for (const s of liveSessions.forClient(ev.payload.clientId)) detachViewer(s.id, ev.payload.clientId);
    });
    bus.subscribe<{ deviceId: string; sessionId: string; event: string; message?: string; data?: Record<string, unknown> }>("agent.session", async (ev) => {
      const { sessionId, event } = ev.payload;
      if (event === "ended" || event === "error") {
        const toPty = ev.payload.data?.bytesToPty;
        if (typeof toPty === "number") noteViewerBytes(sessionId, toPty);
        await endSession(sessionId, ev.payload.message || event);
      } else if (event === "started") {
        const db = await getDb();
        await db.update(schema.remoteSessions).set({ status: "active", connectedAt: new Date() }).where(eq(schema.remoteSessions.id, sessionId));
      }
    });
    bus.subscribe<{ deviceId: string }>("agent.disconnected", async (ev) => {
      for (const s of liveSessions.forDevice(ev.payload.deviceId)) await endSession(s.id, "agent disconnected");
    });
  },
};
export default mod;
