'use strict';

/**
 * PhantomRipperRMM — unified data store.
 *
 * Two backends behind one async API:
 *   - MySQL  (mysql2)        when MYSQL_URL / DATABASE_URL is set  (Railway)
 *   - SQLite (node:sqlite)   otherwise                            (local dev)
 *
 * Both use `?` placeholders. MySQL queries are passed through `translate()`
 * so callers can write SQLite-flavoured SQL (datetime('now')) uniformly.
 */

const config = require('./config');

let backend = null; // { run, get, all, exec, dialect }

// ---------------------------------------------------------------------------
// SQLite backend (node:sqlite)
// ---------------------------------------------------------------------------
function makeSqlite() {
  const { DatabaseSync } = require('node:sqlite');
  const db = new DatabaseSync(config.dbPath);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA foreign_keys = ON;');

  const ddl = `
    CREATE TABLE IF NOT EXISTS users (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      username      TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      role          TEXT NOT NULL DEFAULT 'operator',
      created_at    TEXT NOT NULL DEFAULT (datetime('now')),
      last_login    TEXT
    );
    CREATE TABLE IF NOT EXISTS sessions (
      id            TEXT PRIMARY KEY,
      hostname      TEXT,
      username      TEXT,
      os            TEXT,
      arch          TEXT,
      pid           INTEGER,
      ip            TEXT,
      country       TEXT,
      privilege     TEXT DEFAULT 'user',
      agent_type    TEXT DEFAULT 'python',
      proto         TEXT DEFAULT 'legacy',
      caps          TEXT,
      status        TEXT NOT NULL DEFAULT 'active',
      command_queue TEXT DEFAULT '[]',
      first_seen    TEXT NOT NULL DEFAULT (datetime('now')),
      last_seen     TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS commands (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id   TEXT NOT NULL,
      command      TEXT NOT NULL,
      response     TEXT DEFAULT 'Waiting for response...',
      task_id      TEXT,
      issued_by    TEXT,
      issued_at    TEXT NOT NULL DEFAULT (datetime('now')),
      executed_at  TEXT,
      FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS tasks (
      id           TEXT PRIMARY KEY,
      session_id   TEXT NOT NULL,
      verb         TEXT NOT NULL,
      args         TEXT,
      status       TEXT NOT NULL DEFAULT 'queued',
      response     TEXT,
      issued_by    TEXT,
      created_at   TEXT NOT NULL DEFAULT (datetime('now')),
      executed_at  TEXT,
      FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS artifacts (
      id           TEXT PRIMARY KEY,
      session_id   TEXT NOT NULL,
      task_id      TEXT,
      kind         TEXT NOT NULL,
      name         TEXT,
      size         INTEGER,
      sha256       TEXT,
      path         TEXT,
      created_at   TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS listeners (
      id           TEXT PRIMARY KEY,
      name         TEXT NOT NULL,
      transport    TEXT NOT NULL,
      host         TEXT,
      port         INTEGER,
      path         TEXT,
      profile      TEXT,
      enabled      INTEGER NOT NULL DEFAULT 1,
      created_at   TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS payloads (
      id           TEXT PRIMARY KEY,
      name         TEXT NOT NULL,
      agent_type   TEXT NOT NULL,
      os_target    TEXT NOT NULL,
      transport    TEXT NOT NULL,
      options      TEXT,
      filename     TEXT,
      size         INTEGER,
      sha256       TEXT,
      created_by   TEXT,
      created_at   TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS events (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      level        TEXT NOT NULL DEFAULT 'info',
      category     TEXT NOT NULL,
      message      TEXT NOT NULL,
      meta         TEXT,
      created_at   TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_commands_session ON commands(session_id);
    CREATE INDEX IF NOT EXISTS idx_sessions_status  ON sessions(status);
    CREATE INDEX IF NOT EXISTS idx_events_created   ON events(created_at);
    CREATE INDEX IF NOT EXISTS idx_tasks_session    ON tasks(session_id);
    CREATE INDEX IF NOT EXISTS idx_artifacts_session ON artifacts(session_id);
  `;

  return {
    dialect: 'sqlite',
    async init() {
      db.exec(ddl);
      migrate(db);
    },
    async run(sql, params = []) {
      const r = db.prepare(sql).run(...params);
      return { changes: r.changes, insertId: Number(r.lastInsertRowid) };
    },
    async get(sql, params = []) { return db.prepare(sql).get(...params); },
    async all(sql, params = []) { return db.prepare(sql).all(...params); },
    async exec(sql) { db.exec(sql); },
    async ping() { db.prepare('SELECT 1 AS ok').get(); return true; },
  };
}

// ---------------------------------------------------------------------------
// MySQL backend (mysql2)
// ---------------------------------------------------------------------------
function translate(sql) {
  return sql
    .replace(/datetime\(\s*'now'\s*,\s*'-15 minutes'\s*\)/gi, '(NOW() - INTERVAL 15 MINUTE)')
    .replace(/datetime\(\s*'now'\s*\)/gi, 'NOW()');
}

/** SQLite migration for databases created before v0.2 (new columns). */
function migrate(db) {
  const cols = db.prepare('PRAGMA table_info(sessions)').all().map((c) => c.name);
  if (!cols.includes('proto')) db.exec("ALTER TABLE sessions ADD COLUMN proto TEXT DEFAULT 'legacy'");
  if (!cols.includes('caps')) db.exec('ALTER TABLE sessions ADD COLUMN caps TEXT');
  const cmdCols = db.prepare('PRAGMA table_info(commands)').all().map((c) => c.name);
  if (!cmdCols.includes('task_id')) db.exec('ALTER TABLE commands ADD COLUMN task_id TEXT');
  const userCols = db.prepare('PRAGMA table_info(users)').all().map((c) => c.name);
  if (!userCols.includes('totp_secret')) db.exec('ALTER TABLE users ADD COLUMN totp_secret TEXT');
}

function makeMysql() {
  const mysql = require('mysql2/promise');

  const ddlStatements = [
    `CREATE TABLE IF NOT EXISTS users (
      id            BIGINT AUTO_INCREMENT PRIMARY KEY,
      username      VARCHAR(190) UNIQUE NOT NULL,
      password_hash VARCHAR(255) NOT NULL,
      role          VARCHAR(32) NOT NULL DEFAULT 'operator',
      created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      last_login    DATETIME NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

    `CREATE TABLE IF NOT EXISTS sessions (
      id            VARCHAR(64) PRIMARY KEY,
      hostname      VARCHAR(255),
      username      VARCHAR(190),
      os            VARCHAR(64),
      arch          VARCHAR(64),
      pid           INT,
      ip            VARCHAR(64),
      country       VARCHAR(64),
      privilege     VARCHAR(32) DEFAULT 'user',
      agent_type    VARCHAR(32) DEFAULT 'python',
      proto         VARCHAR(16) DEFAULT 'legacy',
      caps          TEXT,
      status        VARCHAR(32) NOT NULL DEFAULT 'active',
      command_queue JSON,
      first_seen    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      last_seen     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_sessions_status (status)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

    `CREATE TABLE IF NOT EXISTS commands (
      id           BIGINT AUTO_INCREMENT PRIMARY KEY,
      session_id   VARCHAR(64) NOT NULL,
      command      TEXT NOT NULL,
      response     MEDIUMTEXT,
      task_id      VARCHAR(64),
      issued_by    VARCHAR(190),
      issued_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      executed_at  DATETIME NULL,
      INDEX idx_commands_session (session_id),
      CONSTRAINT fk_commands_session FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

    `CREATE TABLE IF NOT EXISTS tasks (
      id           VARCHAR(64) PRIMARY KEY,
      session_id   VARCHAR(64) NOT NULL,
      verb         VARCHAR(64) NOT NULL,
      args         TEXT,
      status       VARCHAR(16) NOT NULL DEFAULT 'queued',
      response     MEDIUMTEXT,
      issued_by    VARCHAR(190),
      created_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      executed_at  DATETIME NULL,
      INDEX idx_tasks_session (session_id),
      CONSTRAINT fk_tasks_session FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

    `CREATE TABLE IF NOT EXISTS artifacts (
      id           VARCHAR(64) PRIMARY KEY,
      session_id   VARCHAR(64) NOT NULL,
      task_id      VARCHAR(64),
      kind         VARCHAR(32) NOT NULL,
      name         VARCHAR(255),
      size         BIGINT,
      sha256       VARCHAR(64),
      path         VARCHAR(512),
      created_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_artifacts_session (session_id),
      CONSTRAINT fk_artifacts_session FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

    `CREATE TABLE IF NOT EXISTS listeners (
      id           VARCHAR(32) PRIMARY KEY,
      name         VARCHAR(190) NOT NULL,
      transport    VARCHAR(32) NOT NULL,
      host         VARCHAR(190),
      port         INT,
      path         VARCHAR(255),
      profile      JSON,
      enabled      TINYINT NOT NULL DEFAULT 1,
      created_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

    `CREATE TABLE IF NOT EXISTS payloads (
      id           VARCHAR(32) PRIMARY KEY,
      name         VARCHAR(190) NOT NULL,
      agent_type   VARCHAR(32) NOT NULL,
      os_target    VARCHAR(32) NOT NULL,
      transport    VARCHAR(32) NOT NULL,
      options      JSON,
      filename     VARCHAR(255),
      size         BIGINT,
      sha256       VARCHAR(64),
      created_by   VARCHAR(190),
      created_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

    `CREATE TABLE IF NOT EXISTS events (
      id           BIGINT AUTO_INCREMENT PRIMARY KEY,
      level        VARCHAR(16) NOT NULL DEFAULT 'info',
      category     VARCHAR(64) NOT NULL,
      message      TEXT NOT NULL,
      meta         JSON,
      created_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_events_created (created_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  ];

  let pool = null;

  return {
    dialect: 'mysql',
    async init() {
      pool = mysql.createPool({
        uri: config.mysqlUrl,
        waitForConnections: true,
        connectionLimit: 10,
        queueLimit: 0,
        multipleStatements: true,
        charset: 'utf8mb4',
        timezone: 'Z',
      });
      // Verify connectivity early.
      await pool.query('SELECT 1');
      await pool.end();

      // Dedicated-database isolation: rewrite the URL's database to our own
      // namespace (creating it first) so co-tenant panels never collide.
      // A pooled `USE` would only stick per-connection — wrong tool.
      const targetDb = process.env.MYSQL_DB || '';
      if (targetDb) {
        const admin = mysql.createPool({ uri: config.mysqlUrl, connectionLimit: 2 });
        await admin.query(`CREATE DATABASE IF NOT EXISTS \`${targetDb}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
        await admin.end();
        const u = new URL(config.mysqlUrl);
        u.pathname = '/' + targetDb;
        pool = mysql.createPool({
          uri: u.toString(),
          waitForConnections: true,
          connectionLimit: 10,
          queueLimit: 0,
          multipleStatements: true,
          charset: 'utf8mb4',
          timezone: 'Z',
        });
      } else {
        pool = mysql.createPool({
          uri: config.mysqlUrl,
          waitForConnections: true,
          connectionLimit: 10,
          queueLimit: 0,
          multipleStatements: true,
          charset: 'utf8mb4',
          timezone: 'Z',
        });
      }
      await pool.query('SELECT 1');

      for (const stmt of ddlStatements) {
        await pool.query(stmt);
      }
      // Migrate pre-v0.2 databases (add columns if missing).
      const [scols] = await pool.query(
        `SELECT COLUMN_NAME FROM information_schema.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'sessions'`
      );
      const names = scols.map((r) => r.COLUMN_NAME || r.column_name);
      if (!names.includes('proto')) await pool.query("ALTER TABLE sessions ADD COLUMN proto VARCHAR(16) DEFAULT 'legacy'");
      if (!names.includes('caps')) await pool.query('ALTER TABLE sessions ADD COLUMN caps TEXT');
      const [ccols] = await pool.query(
        `SELECT COLUMN_NAME FROM information_schema.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'commands'`
      );
      const cnames = ccols.map((r) => r.COLUMN_NAME || r.column_name);
      if (!cnames.includes('task_id')) await pool.query('ALTER TABLE commands ADD COLUMN task_id VARCHAR(64)');
      const [ucols] = await pool.query(
        `SELECT COLUMN_NAME FROM information_schema.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users'`
      );
      const unames = ucols.map((r) => r.COLUMN_NAME || r.column_name);
      if (!unames.includes('totp_secret')) await pool.query('ALTER TABLE users ADD COLUMN totp_secret VARCHAR(64)');
    },
    async run(sql, params = []) {
      const [r] = await pool.execute(translate(sql), params);
      return { changes: r.affectedRows || 0, insertId: r.insertId || 0 };
    },
    async get(sql, params = []) {
      const [rows] = await pool.execute(translate(sql), params);
      return rows[0];
    },
    async all(sql, params = []) {
      const [rows] = await pool.execute(translate(sql), params);
      return rows;
    },
    async exec(sql) { await pool.query(translate(sql)); },
    async ping() { await pool.query('SELECT 1'); return true; },
  };
}

// ---------------------------------------------------------------------------
// selection
// ---------------------------------------------------------------------------
function select() {
  if (config.mysqlUrl) return makeMysql();
  return makeSqlite();
}

backend = select();

module.exports = {
  init: () => backend.init(),
  run: (...a) => backend.run(...a),
  get: (...a) => backend.get(...a),
  all: (...a) => backend.all(...a),
  exec: (...a) => backend.exec(...a),
  ping: () => backend.ping(),
  get dialect() { return backend.dialect; },
};
