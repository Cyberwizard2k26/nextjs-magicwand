'use strict';

/**
 * PhantomRipperRMM — auth: bcrypt passwords + mandatory TOTP (RFC 6238).
 *
 * Login flow:
 *   POST /api/auth/login {username, password}
 *     -> 401 on bad credentials
 *     -> user has TOTP secret  -> {totp_required: true, ticket}
 *     -> user has NO secret    -> {totp_setup: true, ticket, secret, otpauth}
 *                                 (secret auto-provisioned; shown once)
 *   POST /api/auth/totp {ticket, code}
 *     -> verifies 6-digit code against the ticketed user
 *     -> {token, user}  (real session JWT)
 *
 * TOTP_SECRET env pre-seeds the bootstrap admin's secret so an operator can
 * add it to their authenticator app before first login.
 */

const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const store = require('./store');
const config = require('./config');
const totp = require('./totp');

const TOTP_TICKET_TTL = '3m';

async function bootstrapAdmin() {
  const row = await store.get('SELECT COUNT(*) AS n FROM users');
  if (row && row.n > 0) return;
  const hash = bcrypt.hashSync(config.adminPass, 10);
  const secret = config.totpSecret || totp.generateSecret();
  await store.run(
    'INSERT INTO users (username, password_hash, role, totp_secret) VALUES (?, ?, ?, ?)',
    [config.adminUser, hash, 'admin', secret]
  );
  // eslint-disable-next-line no-console
  console.log('[auth] bootstrap admin created: ' + config.adminUser);
  // eslint-disable-next-line no-console
  console.log('[auth] TOTP secret (add to authenticator): ' + secret);
}

async function verifyCredentials(username, password) {
  const user = await store.get('SELECT * FROM users WHERE username = ?', [username]);
  if (!user) return null;
  if (!bcrypt.compareSync(password, user.password_hash)) return null;
  await store.run("UPDATE users SET last_login = datetime('now') WHERE id = ?", [user.id]);
  return { id: user.id, username: user.username, role: user.role };
}

function issueToken(user) {
  return jwt.sign(
    { sub: user.id, username: user.username, role: user.role },
    config.jwtSecret,
    { expiresIn: config.jwtExpires }
  );
}

/** Short-lived ticket that proves password knowledge, gates the TOTP step. */
const usedTickets = new Set();

function issueTotpTicket(username) {
  return jwt.sign({ sub: username, scope: 'totp', jti: require('crypto').randomUUID() },
    config.jwtSecret, { expiresIn: TOTP_TICKET_TTL });
}

function verifyTotpTicket(ticket) {
  try {
    const payload = jwt.verify(ticket, config.jwtSecret);
    if (payload.scope !== 'totp') return null;
    return payload.sub; // username
  } catch (_) {
    return null;
  }
}

/** Mark a ticket consumed; returns false if it was already used (replay). */
function consumeTotpTicket(ticket) {
  try {
    const payload = jwt.verify(ticket, config.jwtSecret);
    if (payload.scope !== 'totp' || !payload.jti) return false;
    if (usedTickets.has(payload.jti)) return false;
    usedTickets.add(payload.jti);
    if (usedTickets.size > 10000) usedTickets.clear(); // bounded
    return true;
  } catch (_) {
    return false;
  }
}

function verifyToken(token) {
  try {
    return jwt.verify(token, config.jwtSecret);
  } catch (_) {
    return null;
  }
}

async function getTotpSecret(username) {
  const row = await store.get('SELECT totp_secret FROM users WHERE username = ?', [username]);
  return row ? row.totp_secret : null;
}

async function setTotpSecret(username, secret) {
  await store.run('UPDATE users SET totp_secret = ? WHERE username = ?', [secret, username]);
}

async function createUser(username, password, role = 'operator') {
  const hash = bcrypt.hashSync(password, 10);
  const info = await store.run(
    'INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?, ?)',
    [username, hash, role]
  );
  return { id: info.insertId, username, role };
}

/** Express middleware — requires a valid session token. */
function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : (req.query.token || '');
  const payload = verifyToken(token);
  if (!payload) return res.status(401).json({ error: 'unauthorized' });
  req.user = payload;
  next();
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'unauthorized' });
    if (!roles.includes(req.user.role)) return res.status(403).json({ error: 'forbidden' });
    next();
  };
}

/** WebSocket upgrade auth — token via query string. */
function authenticateWs(url) {
  try {
    const u = new URL(url, 'http://localhost');
    const token = u.searchParams.get('token');
    if (!token) return null;
    return verifyToken(token);
  } catch (_) {
    return null;
  }
}

module.exports = {
  bootstrapAdmin,
  verifyCredentials,
  issueToken,
  issueTotpTicket,
  verifyTotpTicket,
  consumeTotpTicket,
  getTotpSecret,
  setTotpSecret,
  verifyToken,
  createUser,
  requireAuth,
  requireRole,
  authenticateWs,
};
