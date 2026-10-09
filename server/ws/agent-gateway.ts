/**
 * Agent WebSocket gateway. Lifecycle:
 *   agent: hello  ->  server: challenge  ->  agent: challenge_response  ->  server: welcome
 * then free-form messages. Binary frames are routed by stream id to active remote sessions.
 */
import type { IncomingMessage } from "node:http";
import { createPublicKey, verify as edVerify, randomBytes } from "node:crypto";
import type { WebSocket } from "ws";
import { AgentMessage, type AgentHello, PROTOCOL_VERSION, decodeStreamFrame } from "@/lib/protocol/agent";
import { agentRegistry, type AgentConnection } from "@/lib/realtime/agent-registry";
import { enrollOrResolve, markOnline, markOffline, touchHeartbeat, recordTelemetry, applyInventory, addDeviceEvent, agentConfigFor, type Device } from "@/lib/services/devices";
import { bus } from "@/lib/bus";
import { config } from "@/lib/config";
import { createLogger } from "@/lib/logger";
import { clientIp } from "@/lib/auth/session";
import { SERVER_VERSION } from "@/lib/version";

const log = createLogger("agent-gw");
const HANDSHAKE_TIMEOUT_MS = 15_000;

function verifySignature(publicKeyB64: string, nonce: string, signatureB64: string): boolean {
  try {
    const raw = Buffer.from(publicKeyB64, "base64");
    // Ed25519 raw 32-byte public key -> SPKI DER
    const spki = Buffer.concat([Buffer.from("302a300506032b6570032100", "hex"), raw]);
    const key = createPublicKey({ key: spki, format: "der", type: "spki" });
    return edVerify(null, Buffer.from(nonce), key, Buffer.from(signatureB64, "base64"));
  } catch {
    return false;
  }
}

export function handleAgentSocket(socket: WebSocket, req: IncomingMessage) {
  const ip = clientIp(req.headers, req.socket.remoteAddress);
  let conn: AgentConnection | null = null;
  let hello: AgentHello | null = null;
  let device: Device | null = null;
  let nonce = "";
  let alive = true;

  const handshakeTimer = setTimeout(() => {
    if (!conn) socket.close(4000, "handshake timeout");
  }, HANDSHAKE_TIMEOUT_MS);

  const send = (msg: unknown) => {
    try { socket.send(JSON.stringify(msg)); } catch { /* ignore */ }
  };
  const fail = (code: string, message: string) => {
    log.warn("agent rejected", { ip, code, message, agentId: hello?.agentId });
    send({ t: "error", code, message, fatal: true });
    socket.close(4003, code);
  };

  socket.on("pong", () => { alive = true; });
  const pingTimer = setInterval(() => {
    if (!alive) { socket.terminate(); return; }
    alive = false;
    try { socket.ping(); } catch { /* ignore */ }
  }, config.agent.heartbeatSeconds * 1000 * 2);

  socket.on("message", async (raw, isBinary) => {
    try {
      if (isBinary) {
        if (!conn) return;
        const buf = raw as Buffer;
        conn.bytesIn += buf.byteLength;
        conn.lastSeenAt = new Date();
        const { streamId, payload } = decodeStreamFrame(new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength));
        agentRegistry.handleBinary(conn, streamId, payload);
        return;
      }
      const text = raw.toString();
      if (text.length > config.agent.maxMessageBytes) return fail("too_large", "message too large");
      const parsed = AgentMessage.safeParse(JSON.parse(text));
      if (!parsed.success) {
        log.debug("bad agent message", { ip, issues: parsed.error.issues.slice(0, 3) });
        if (!conn) return fail("bad_message", "invalid message");
        return;
      }
      const msg = parsed.data;

      // ---- handshake ----
      if (!conn) {
        if (msg.t === "hello") {
          if (msg.protocol !== PROTOCOL_VERSION) return fail("protocol", `unsupported protocol ${msg.protocol}`);
          hello = msg;
          nonce = randomBytes(32).toString("base64");
          send({ t: "challenge", nonce });
          return;
        }
        if (msg.t === "challenge_response" && hello) {
          if (!verifySignature(hello.publicKey, nonce, msg.signature)) return fail("bad_signature", "signature verification failed");
          let result;
          try {
            result = await enrollOrResolve(hello, ip);
          } catch (err) {
            return fail("enroll_failed", String((err as Error).message || err));
          }
          device = result.device;
          clearTimeout(handshakeTimer);
          conn = { deviceId: device.id, orgId: device.orgId, agentId: hello.agentId, hello, socket, ip, connectedAt: new Date(), lastSeenAt: new Date(), pending: new Map(), streams: new Map(), nextStreamId: 1, bytesIn: 0, bytesOut: 0 };
          agentRegistry.add(conn);
          await markOnline(device, hello, ip);
          const agentConfig = await agentConfigFor(device);
          send({ t: "welcome", deviceId: device.id, orgId: device.orgId, serverTime: new Date().toISOString(), heartbeatSeconds: config.agent.heartbeatSeconds, config: agentConfig, pendingApproval: result.pendingApproval, serverVersion: SERVER_VERSION });
          bus.publish("agent.connected", { deviceId: device.id, isNew: result.isNew, capabilities: hello.capabilities, agentVersion: hello.agentVersion }, { orgId: device.orgId, deviceId: device.id });
          log.info("agent connected", { deviceId: device.id, host: hello.hostname, ip, version: hello.agentVersion });
          return;
        }
        return fail("handshake", "expected hello");
      }

      // ---- steady state ----
      conn.lastSeenAt = new Date();
      const d = device as Device;
      switch (msg.t) {
        case "heartbeat":
          await touchHeartbeat(d.id, { loggedInUsers: msg.loggedInUsers, loggedInUser: msg.loggedInUsers?.[0]?.user, publicIp: msg.publicIp, pendingReboot: msg.pendingReboot });
          send({ t: "pong", serverTime: new Date().toISOString() });
          bus.publish("device.heartbeat", { deviceId: d.id, loggedInUsers: msg.loggedInUsers, pendingReboot: msg.pendingReboot }, { orgId: d.orgId, deviceId: d.id });
          break;
        case "telemetry": {
          const { t: _t, ts, ...rest } = msg;
          void _t;
          await recordTelemetry(d, { ...rest, ts: new Date(ts) });
          break;
        }
        case "inventory":
          await applyInventory(d, msg);
          break;
        case "event":
          await addDeviceEvent(d.id, d.orgId, { type: msg.type, message: msg.message, severity: msg.severity, source: msg.source, data: msg.data, ts: msg.ts ? new Date(msg.ts) : undefined });
          break;
        case "output":
          agentRegistry.handleOutput(conn, msg.id, msg.stream, msg.data);
          bus.publish("agent.output", { deviceId: d.id, id: msg.id, stream: msg.stream, data: msg.data }, { orgId: d.orgId, deviceId: d.id });
          break;
        case "result":
          if (!agentRegistry.handleResult(conn, msg)) {
            // No local waiter (server restarted or job dispatched elsewhere): hand to the jobs module via the bus.
            bus.publish("agent.result.orphan", { deviceId: d.id, result: msg }, { orgId: d.orgId, deviceId: d.id });
          }
          break;
        case "monitor":
          bus.publish("agent.monitor", { deviceId: d.id, ...msg }, { orgId: d.orgId, deviceId: d.id });
          break;
        case "session":
          bus.publish("agent.session", { deviceId: d.id, ...msg }, { orgId: d.orgId, deviceId: d.id });
          break;
        case "chat":
          bus.publish("chat.from_device", { deviceId: d.id, body: msg.body, sessionId: msg.sessionId, user: msg.user }, { orgId: d.orgId, deviceId: d.id });
          break;
        case "help_request":
          bus.publish("device.help_request", { deviceId: d.id, subject: msg.subject, body: msg.body, user: msg.user, screenshot: msg.screenshot }, { orgId: d.orgId, deviceId: d.id });
          break;
        case "log":
          log[msg.level === "warn" ? "warn" : msg.level === "error" ? "error" : "debug"](`[agent ${d.hostname}] ${msg.message}`, msg.data);
          break;
        case "hello":
        case "challenge_response":
          break;
      }
    } catch (err) {
      log.error("agent message handling failed", { err: String((err as Error).stack || err), deviceId: conn?.deviceId });
    }
  });

  socket.on("close", async (code, reason) => {
    clearTimeout(handshakeTimer);
    clearInterval(pingTimer);
    if (conn && device) {
      agentRegistry.remove(conn);
      if (agentRegistry.get(device.id) === undefined) await markOffline(device.id, device.orgId, `socket closed ${code} ${reason?.toString() || ""}`.trim());
      bus.publish("agent.disconnected", { deviceId: device.id, code }, { orgId: device.orgId, deviceId: device.id });
      log.info("agent disconnected", { deviceId: device.id, code });
    }
  });
  socket.on("error", (err) => log.debug("agent socket error", { err: String(err), deviceId: conn?.deviceId }));
}
