/** Tiny structured logger (JSON in production, pretty in development). Zero dependencies. */
type Level = "debug" | "info" | "warn" | "error";
const LEVELS: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const minLevel: number = LEVELS[(process.env.LOG_LEVEL as Level) || (process.env.NODE_ENV === "production" ? "info" : "debug")] ?? 20;
const json = process.env.LOG_FORMAT === "json" || (process.env.NODE_ENV === "production" && process.env.LOG_FORMAT !== "pretty");

function emit(level: Level, scope: string, msg: string, meta?: Record<string, unknown>) {
  if (LEVELS[level] < minLevel) return;
  const ts = new Date().toISOString();
  if (json) {
    process.stdout.write(JSON.stringify({ ts, level, scope, msg, ...(meta ?? {}) }) + "\n");
    return;
  }
  const color = { debug: "\x1b[90m", info: "\x1b[36m", warn: "\x1b[33m", error: "\x1b[31m" }[level];
  const extra = meta && Object.keys(meta).length ? " " + JSON.stringify(meta) : "";
  process.stdout.write(`${color}${ts} ${level.toUpperCase().padEnd(5)}\x1b[0m [${scope}] ${msg}${extra}\n`);
}

export interface Logger {
  debug(msg: string, meta?: Record<string, unknown>): void;
  info(msg: string, meta?: Record<string, unknown>): void;
  warn(msg: string, meta?: Record<string, unknown>): void;
  error(msg: string, meta?: Record<string, unknown>): void;
  child(scope: string): Logger;
}

export function createLogger(scope: string): Logger {
  return {
    debug: (m, meta) => emit("debug", scope, m, meta),
    info: (m, meta) => emit("info", scope, m, meta),
    warn: (m, meta) => emit("warn", scope, m, meta),
    error: (m, meta) => emit("error", scope, m, meta),
    child: (s) => createLogger(`${scope}:${s}`),
  };
}

export const log = createLogger("app");
