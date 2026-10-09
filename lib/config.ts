/**
 * Central runtime configuration. Everything is driven by environment variables so the
 * same build runs on Railway, a Linux VPS, a Windows VPS, Docker, or a laptop.
 */
import path from "node:path";

function bool(v: string | undefined, def = false): boolean {
  if (v === undefined || v === "") return def;
  return ["1", "true", "yes", "on"].includes(v.toLowerCase());
}
function int(v: string | undefined, def: number): number {
  const n = Number.parseInt(v ?? "", 10);
  return Number.isFinite(n) ? n : def;
}

const dataDir = process.env.DATA_DIR || path.join(process.cwd(), "data");

export const config = {
  env: process.env.NODE_ENV === "production" ? "production" : "development",
  isProd: process.env.NODE_ENV === "production",
  port: int(process.env.PORT, 3000),
  host: process.env.HOST || "0.0.0.0",
  /** Public URL used in installer links, emails, OIDC callbacks and agent enrollment. */
  publicUrl: (process.env.PUBLIC_URL || process.env.RAILWAY_PUBLIC_DOMAIN
    ? process.env.PUBLIC_URL || `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`
    : `http://localhost:${int(process.env.PORT, 3000)}`
  ).replace(/\/$/, ""),
  dataDir,
  /** Postgres connection string. When absent we run embedded Postgres (PGlite) inside DATA_DIR. */
  databaseUrl: process.env.DATABASE_URL || "",
  redisUrl: process.env.REDIS_URL || "",
  /** 32+ byte secret used to sign cookies, agent tokens and download links. Generated on first boot if absent. */
  secret: process.env.APP_SECRET || "",
  trustProxy: bool(process.env.TRUST_PROXY, true),
  secureCookies: bool(process.env.SECURE_COOKIES, process.env.NODE_ENV === "production"),
  sessionTtlHours: int(process.env.SESSION_TTL_HOURS, 24 * 7),
  agent: {
    heartbeatSeconds: int(process.env.AGENT_HEARTBEAT_SECONDS, 30),
    offlineAfterSeconds: int(process.env.AGENT_OFFLINE_AFTER_SECONDS, 120),
    /** Directory holding pre-built agent binaries used by the installer builder. */
    binDir: process.env.AGENT_BIN_DIR || path.join(dataDir, "agent-bin"),
    maxMessageBytes: int(process.env.AGENT_MAX_MESSAGE_BYTES, 16 * 1024 * 1024),
  },
  smtp: {
    url: process.env.SMTP_URL || "",
    from: process.env.SMTP_FROM || "MagicWand RMM <no-reply@localhost>",
  },
  ai: {
    anthropicApiKey: process.env.ANTHROPIC_API_KEY || "",
    model: process.env.AI_MODEL || "claude-sonnet-5-5",
  },
  bootstrap: {
    /** First-boot admin. If unset, the setup wizard at /setup creates the first org + admin. */
    adminEmail: process.env.ADMIN_EMAIL || "",
    adminPassword: process.env.ADMIN_PASSWORD || "",
    orgName: process.env.ORG_NAME || "",
  },
  telemetry: {
    retentionDays: int(process.env.TELEMETRY_RETENTION_DAYS, 30),
    eventRetentionDays: int(process.env.EVENT_RETENTION_DAYS, 90),
  },
  features: {
    aiCopilot: bool(process.env.FEATURE_AI, true),
    signup: bool(process.env.FEATURE_SIGNUP, false),
  },
} as const;

export type AppConfig = typeof config;
