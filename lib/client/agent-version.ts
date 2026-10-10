/** Agent version ordering shared by the server (tree aggregates) and the browser (outdated markers). Pure, no imports. */

/**
 * Compare two agent version strings ("1.4.2", "0.1.0-dev", "v2.0"). Numeric segments compare numerically, a
 * pre-release suffix sorts below the plain release of the same numbers. Returns <0, 0 or >0.
 */
export function compareVersions(a: string, b: string): number {
  const parse = (v: string) => {
    const clean = v.trim().replace(/^v/i, "");
    const [core, pre] = clean.split(/[-+]/, 2);
    const nums = core.split(".").map((p) => { const n = Number.parseInt(p, 10); return Number.isFinite(n) ? n : 0; });
    return { nums, pre: pre ?? null };
  };
  const pa = parse(a), pb = parse(b);
  const len = Math.max(pa.nums.length, pb.nums.length);
  for (let i = 0; i < len; i++) {
    const d = (pa.nums[i] ?? 0) - (pb.nums[i] ?? 0);
    if (d !== 0) return d;
  }
  if (pa.pre === pb.pre) return 0;
  if (pa.pre === null) return 1;
  if (pb.pre === null) return -1;
  return pa.pre.localeCompare(pb.pre);
}

/** The newest version in a list, or null when the list is empty. */
export function newestVersion(versions: (string | null | undefined)[]): string | null {
  let best: string | null = null;
  for (const v of versions) {
    if (!v) continue;
    if (best === null || compareVersions(v, best) > 0) best = v;
  }
  return best;
}

export function isOutdated(version: string | null | undefined, newest: string | null | undefined): boolean {
  return !!version && !!newest && compareVersions(version, newest) < 0;
}
