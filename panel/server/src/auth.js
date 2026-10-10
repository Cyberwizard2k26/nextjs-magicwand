'use strict';

/**
 * PhantomRipperRMM — auth.
 * JWT bearer tokens + bcrypt password hashing. Bootstraps an admin user
 * on first boot so the panel is never locked out.
 */

const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const store = require('./store');
const config = require('./config');

async function bootstrapAdmin() {
  const row = await store.get('SELECT COUNT(*) AS n FROM users');
  if (row && row.n > 0) return;
  const hash = bcrypt.hashSync(config.adminPass, 10);
  await store.run(
    'INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)',
    [config.adminUser, hash, 'admin']
  );
  // eslint-disable-next-line no-console
  console.log(`[auth] bootstrap admin created: ${config.adminUser} (change the password!)`);
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

function verifyToken(token) {
  try {
    return jwt.verify(token, config.jwtSecret);
  } catch (_) {
    return null;
  }
}

async function createUser(username, password, role = 'operator') {
  const hash = bcrypt.hashSync(password, 10);
  const info = await store.run(
    'INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)',
    [username, hash, role]
  );
  return { id: info.insertId, username, role };
}

/** Express middleware — requires a valid bearer token. */
function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : (req.query.token || '');
  const payload = verifyToken(token);
  if (!payload) return res.status(401).json({ error: 'unauthorized' });
  req.user = payload;
  next();
}

/** Express middleware factory — requires one of the given roles. */
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
  verifyToken,
  createUser,
  requireAuth,
  requireRole,
  authenticateWs,
};
