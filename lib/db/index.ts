/**
 * Database access. Two interchangeable backends behind one Drizzle API:
 *  - DATABASE_URL set  -> PostgreSQL via node-postgres (production, Railway Postgres plugin, VPS Postgres)
 *  - DATABASE_URL unset-> PGlite, an embedded Postgres persisted under DATA_DIR/pg (single-node, dev, demos)
 */
import path from "node:path";
import fs from "node:fs";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import * as schema from "./schema";
import { config } from "../config";
import { createLogger } from "../logger";

const log = createLogger("db");

export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;
export { schema };

interface DbGlobal {
  __mwDb?: Db;
  __mwDbInit?: Promise<Db>;
  __mwDbClose?: () => Promise<void>;
}
const g = globalThis as unknown as DbGlobal;

const MIGRATIONS_FOLDER = path.join(process.cwd(), "drizzle");

async function init(): Promise<Db> {
  if (config.databaseUrl) {
    const { drizzle } = await import("drizzle-orm/node-postgres");
    const { migrate } = await import("drizzle-orm/node-postgres/migrator");
    const { Pool } = await import("pg");
    const pool = new Pool({
      connectionString: config.databaseUrl,
      max: Number.parseInt(process.env.DATABASE_POOL_MAX || "10", 10),
      ssl: /sslmode=require|ssl=true/.test(config.databaseUrl) || process.env.DATABASE_SSL === "true" ? { rejectUnauthorized: process.env.DATABASE_SSL_REJECT_UNAUTHORIZED !== "false" } : undefined,
    });
    const db = drizzle(pool, { schema, casing: "snake_case" });
    log.info("connecting to PostgreSQL");
    if (fs.existsSync(MIGRATIONS_FOLDER)) await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
    g.__mwDbClose = () => pool.end();
    return db as unknown as Db;
  }
  const { PGlite } = await import("@electric-sql/pglite");
  const { drizzle } = await import("drizzle-orm/pglite");
  const { migrate } = await import("drizzle-orm/pglite/migrator");
  const dir = process.env.PGLITE_MEMORY === "1" ? undefined : path.join(config.dataDir, "pg");
  if (dir) fs.mkdirSync(dir, { recursive: true });
  const client = dir ? new PGlite(dir) : new PGlite();
  await client.waitReady;
  const db = drizzle(client, { schema, casing: "snake_case" });
  log.info(dir ? `embedded PostgreSQL (PGlite) at ${dir}` : "embedded PostgreSQL (PGlite) in memory");
  if (fs.existsSync(MIGRATIONS_FOLDER)) await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
  g.__mwDbClose = () => client.close();
  return db as unknown as Db;
}

/** Returns the shared database handle, initialising (and migrating) it on first use. */
export async function getDb(): Promise<Db> {
  if (g.__mwDb) return g.__mwDb;
  if (!g.__mwDbInit) {
    g.__mwDbInit = init().then((db) => {
      g.__mwDb = db;
      return db;
    });
  }
  return g.__mwDbInit;
}

/** Synchronous accessor for code paths that run strictly after boot (server process, services). */
export function db(): Db {
  if (!g.__mwDb) throw new Error("Database not initialised - await getDb() first");
  return g.__mwDb;
}

export async function closeDb() {
  await g.__mwDbClose?.();
  g.__mwDb = undefined;
  g.__mwDbInit = undefined;
}
