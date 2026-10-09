/** RFC 6238 TOTP + RFC 4226 HOTP without third-party dependencies. */
import { createHmac, randomBytes } from "node:crypto";

const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32Encode(buf: Buffer): string {
  let bits = 0, value = 0, out = "";
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) { out += B32[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}
export function base32Decode(s: string): Buffer {
  const clean = s.toUpperCase().replace(/[^A-Z2-7]/g, "");
  let bits = 0, value = 0;
  const out: number[] = [];
  for (const c of clean) {
    value = (value << 5) | B32.indexOf(c);
    bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(out);
}

export function generateTotpSecret(): string {
  return base32Encode(randomBytes(20));
}

export function hotp(secret: string, counter: number, digits = 6): string {
  const key = base32Decode(secret);
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));
  const h = createHmac("sha1", key).update(buf).digest();
  const offset = h[h.length - 1] & 0xf;
  const code = ((h[offset] & 0x7f) << 24) | ((h[offset + 1] & 0xff) << 16) | ((h[offset + 2] & 0xff) << 8) | (h[offset + 3] & 0xff);
  return String(code % 10 ** digits).padStart(digits, "0");
}

export function totp(secret: string, time = Date.now(), step = 30, digits = 6): string {
  return hotp(secret, Math.floor(time / 1000 / step), digits);
}

/** Verify with a +/- 1 step window. */
export function verifyTotp(secret: string, code: string, window = 1, time = Date.now()): boolean {
  const c = code.replace(/\s/g, "");
  if (!/^\d{6}$/.test(c)) return false;
  const counter = Math.floor(time / 1000 / 30);
  for (let w = -window; w <= window; w++) if (hotp(secret, counter + w) === c) return true;
  return false;
}

export function totpUri(secret: string, account: string, issuer = "MagicWand RMM"): string {
  return `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(account)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
}
