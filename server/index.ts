/**
 * MagicWand RMM server entry point: Next.js (UI + REST API) and the WebSocket gateways on ONE port so it
 * deploys anywhere a single HTTP port is exposed (Railway, Docker, a VPS behind nginx/Caddy, Windows).
 */
import { createServer } from "node:http";
import { parse } from "node:url";
import next from "next";
import { WebSocketServer } from "ws";
import { config } from "@/lib/config";
import { boot } from "@/lib/boot";
import { createLogger } from "@/lib/logger";
import { handleAgentSocket } from "./ws/agent-gateway";
import { handleClientSocket } from "./ws/client-gateway";

const log = createLogger("server");
const dev = !config.isProd;

async function main() {
  await boot({ withServices: true });
  const app = next({ dev, hostname: config.host, port: config.port });
  const handle = app.getRequestHandler();
  await app.prepare();

  const server = createServer((req, res) => {
    handle(req, res, parse(req.url || "/", true)).catch((err) => {
      log.error("request failed", { err: String(err) });
      if (!res.headersSent) res.statusCode = 500;
      res.end("internal error");
    });
  });

  const agentWss = new WebSocketServer({ noServer: true, maxPayload: config.agent.maxMessageBytes, perMessageDeflate: false });
  const clientWss = new WebSocketServer({ noServer: true, maxPayload: 16 * 1024 * 1024, perMessageDeflate: false });
  agentWss.on("connection", handleAgentSocket);
  clientWss.on("connection", (socket, req) => { handleClientSocket(socket, req).catch((err) => log.error("client socket failed", { err: String(err) })); });

  server.on("upgrade", (req, socket, head) => {
    const { pathname } = parse(req.url || "/");
    if (pathname === "/agent/ws") {
      agentWss.handleUpgrade(req, socket, head, (ws) => agentWss.emit("connection", ws, req));
    } else if (pathname === "/ws") {
      clientWss.handleUpgrade(req, socket, head, (ws) => clientWss.emit("connection", ws, req));
    } else if (dev && pathname?.startsWith("/_next")) {
      // Next.js HMR websocket in development
      const upgrade = app.getUpgradeHandler();
      upgrade(req, socket, head);
    } else {
      socket.destroy();
    }
  });

  server.keepAliveTimeout = 65_000;
  server.listen(config.port, config.host, () => {
    log.info(`listening on http://${config.host}:${config.port} (${dev ? "development" : "production"})`);
  });

  const shutdown = (signal: string) => {
    log.info(`received ${signal}, shutting down`);
    for (const ws of agentWss.clients) ws.close(1001, "server restarting");
    for (const ws of clientWss.clients) ws.close(1001, "server restarting");
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 5_000).unref();
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

main().catch((err) => {
  log.error("fatal", { err: String(err?.stack || err) });
  process.exit(1);
});
