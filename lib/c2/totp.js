'use strict';

/**
 * PhantomRipperRMM — TOTP (RFC 6238) with zero dependencies.
 * SHA1, 6 digits, 30s period, ±1 step drift tolerance.
 */

const crypto = require('crypto');

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function base32Encode(buf) {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

function base32Decode(str) {
  const clean = str.toUpperCase().replace(/[^A-Z2-7]/g, '');
  let bits = 0;
  let value = 0;
  const out = [];
  for (const ch of clean) {
    value = (value << 5) | B32.indexOf(ch);
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xFF);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

function generateSecret(bytes = 20) {
  return base32Encode(crypto.randomBytes(bytes));
}

function hotp(secretB32, counter) {
  const key = base32Decode(secretB32);
  const buf = Buffer.alloc(8);
  buf.writeUInt32BE(Math.floor(counter / 0x100000000), 0);
  buf.writeUInt32BE(counter >>> 0, 4);
  const h = crypto.createHmac('sha1', key).update(buf).digest();
  const off = h[h.length - 1] & 0xF;
  const code = ((h[off] & 0x7F) << 24 | h[off + 1] << 16 | h[off + 2] << 8 | h[off + 3]) % 1000000;
  return String(code).padStart(6, '0');
}

/** Constant-time-ish check with ±window steps of drift. */
function verifyToken(secretB32, token, window = 1) {
  if (!secretB32 || !/^\d{6}$/.test(String(token || ''))) return false;
  const t = Math.floor(Date.now() / 30000);
  let ok = false;
  for (let e = -window; e <= window && !ok; e++) {
    const expect = hotp(secretB32, t + e);
    if (crypto.timingSafeEqual(Buffer.from(expect), Buffer.from(String(token)))) ok = true;
  }
  return ok;
}

function otpauthUri(secret, user, issuer = 'PhantomRipperRMM') {
  return `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(user)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
}

module.exports = { generateSecret, verifyToken, hotp, otpauthUri, base32Encode, base32Decode };
