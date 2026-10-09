import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, scrypt as _scrypt, timingSafeEqual, hkdfSync, type ScryptOptions } from "node:crypto";

function scrypt(password: string, salt: Buffer, keylen: number, options: ScryptOptions): Promise<Buffer> {
  return new Promise((resolve, reject) => _scrypt(password, salt, keylen, options, (err, key) => (err ? reject(err) : resolve(key))));
}

// Kept on globalThis (not a module variable): bundlers may instantiate this module more than once per process.
interface SecretGlobal { __mwMasterSecret?: Buffer }
const g = globalThis as unknown as SecretGlobal;

/** Called once at boot with APP_SECRET (or the generated/persisted secret). */
export function setMasterSecret(secret: string) {
  g.__mwMasterSecret = Buffer.from(secret, "utf8");
}
export function getMasterSecret(): Buffer {
  if (!g.__mwMasterSecret) {
    // Late initialisation path: API routes may run before/without the custom server's boot() in some dev setups.
    const env = process.env.APP_SECRET;
    if (env) g.__mwMasterSecret = Buffer.from(env, "utf8");
    else throw new Error("Master secret not initialised - call setMasterSecret() at boot");
  }
  return g.__mwMasterSecret;
}
function deriveKey(purpose: string): Buffer {
  return Buffer.from(hkdfSync("sha256", getMasterSecret(), "magicwand", purpose, 32));
}

/** AES-256-GCM encryption for secrets at rest. Output: v1.<iv>.<tag>.<ciphertext> (base64url). */
export function encryptSecret(plaintext: string, purpose = "secrets"): string {
  const key = deriveKey(purpose);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ["v1", iv.toString("base64url"), tag.toString("base64url"), ct.toString("base64url")].join(".");
}
export function decryptSecret(payload: string, purpose = "secrets"): string {
  const [v, ivB, tagB, ctB] = payload.split(".");
  if (v !== "v1" || !ivB || !tagB || !ctB) throw new Error("Invalid encrypted payload");
  const key = deriveKey(purpose);
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(ivB, "base64url"));
  decipher.setAuthTag(Buffer.from(tagB, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(ctB, "base64url")), decipher.final()]).toString("utf8");
}
export function encryptJson(value: unknown, purpose?: string) { return encryptSecret(JSON.stringify(value), purpose); }
export function decryptJson<T = unknown>(payload: string, purpose?: string): T { return JSON.parse(decryptSecret(payload, purpose)) as T; }

/** Password hashing with scrypt (N=2^15, r=8, p=1) - no native dependencies. */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(password.normalize("NFKC"), salt, 64, { N: 1 << 15, r: 8, p: 1, maxmem: 128 * 1024 * 1024 });
  return `scrypt$${salt.toString("base64url")}$${key.toString("base64url")}`;
}
export async function verifyPassword(password: string, stored: string | null | undefined): Promise<boolean> {
  if (!stored) return false;
  const [algo, saltB, keyB] = stored.split("$");
  if (algo !== "scrypt" || !saltB || !keyB) return false;
  const expected = Buffer.from(keyB, "base64url");
  const actual = await scrypt(password.normalize("NFKC"), Buffer.from(saltB, "base64url"), expected.length, { N: 1 << 15, r: 8, p: 1, maxmem: 128 * 1024 * 1024 });
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function sha256(data: string | Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}
export function hmacSha256(key: string | Buffer, data: string | Buffer): string {
  return createHmac("sha256", key).update(data).digest("hex");
}
/** Random opaque token (base64url, 32 bytes by default). */
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}
/** Hash a bearer-style token for storage; keyed with the master secret so a DB leak alone cannot forge tokens. */
export function hashToken(token: string): string {
  return createHmac("sha256", deriveKey("tokens")).update(token).digest("hex");
}
export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}
/** Short human-friendly codes (recovery codes, pairing codes). */
export function humanCode(groups = 2, groupLen = 5): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const out: string[] = [];
  for (let g = 0; g < groups; g++) {
    let s = "";
    const bytes = randomBytes(groupLen);
    for (let i = 0; i < groupLen; i++) s += alphabet[bytes[i] % alphabet.length];
    out.push(s);
  }
  return out.join("-");
}
