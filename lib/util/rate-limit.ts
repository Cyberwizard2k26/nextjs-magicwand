/** Fixed-window in-memory rate limiter (per node). Good enough for auth endpoints; Redis-backed variant can replace it. */
const buckets = new Map<string, { count: number; resetAt: number }>();
let sweepAt = Date.now() + 60_000;

export function rateLimit(key: string, max: number, windowMs: number): boolean {
  const now = Date.now();
  if (now > sweepAt) {
    for (const [k, b] of buckets) if (b.resetAt < now) buckets.delete(k);
    sweepAt = now + 60_000;
  }
  const b = buckets.get(key);
  if (!b || b.resetAt < now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  b.count++;
  return b.count <= max;
}
