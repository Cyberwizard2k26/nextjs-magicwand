/**
 * File storage for uploads, recordings, report outputs and agent binaries. Local disk under DATA_DIR by default;
 * the same interface can be backed by S3-compatible storage (see docs/DEPLOYMENT.md).
 */
import fs from "node:fs";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import { config } from "../config";

export type StorageBucket = "uploads" | "recordings" | "reports" | "agent-bin" | "tmp";

function root(bucket: StorageBucket): string {
  const dir = bucket === "agent-bin" ? config.agent.binDir : path.join(config.dataDir, bucket);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/** Resolve a key inside a bucket, refusing path traversal. */
export function storagePath(bucket: StorageBucket, key: string): string {
  const base = root(bucket);
  const full = path.resolve(base, key);
  if (!full.startsWith(base + path.sep) && full !== base) throw new Error("invalid storage key");
  return full;
}

export async function putObject(bucket: StorageBucket, key: string, data: Buffer | Readable | string): Promise<{ key: string; size: number }> {
  const full = storagePath(bucket, key);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  if (typeof data === "string" || Buffer.isBuffer(data)) {
    fs.writeFileSync(full, data);
  } else {
    await pipeline(data, fs.createWriteStream(full));
  }
  return { key, size: fs.statSync(full).size };
}

export function getObjectStream(bucket: StorageBucket, key: string): fs.ReadStream {
  return fs.createReadStream(storagePath(bucket, key));
}
export function getObject(bucket: StorageBucket, key: string): Buffer {
  return fs.readFileSync(storagePath(bucket, key));
}
export function objectExists(bucket: StorageBucket, key: string): boolean {
  try { return fs.statSync(storagePath(bucket, key)).isFile(); } catch { return false; }
}
export function objectSize(bucket: StorageBucket, key: string): number {
  return fs.statSync(storagePath(bucket, key)).size;
}
export function deleteObject(bucket: StorageBucket, key: string) {
  try { fs.unlinkSync(storagePath(bucket, key)); } catch { /* ignore */ }
}
export function listObjects(bucket: StorageBucket, prefix = ""): string[] {
  const base = root(bucket);
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else out.push(path.relative(base, p).split(path.sep).join("/"));
    }
  };
  if (fs.existsSync(base)) walk(base);
  return out.filter((k) => k.startsWith(prefix));
}
/** Append-friendly writer (recordings). */
export function openAppendStream(bucket: StorageBucket, key: string): fs.WriteStream {
  const full = storagePath(bucket, key);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  return fs.createWriteStream(full, { flags: "a" });
}
