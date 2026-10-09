/** Read models for the device page: inventory sections, telemetry history and the unified timeline. */
import { and, desc, eq, gte, ilike, isNull, lt, or, sql } from "drizzle-orm";
import { getDb, schema } from "../db";

export async function deviceSoftware(deviceId: string, q?: string) {
  const db = await getDb();
  const where = [eq(schema.deviceSoftware.deviceId, deviceId), isNull(schema.deviceSoftware.removedAt)];
  if (q) where.push(or(ilike(schema.deviceSoftware.name, `%${q}%`), ilike(schema.deviceSoftware.publisher, `%${q}%`))!);
  return db.select().from(schema.deviceSoftware).where(and(...where)).orderBy(schema.deviceSoftware.name).limit(2000);
}

export async function deviceServices(deviceId: string) {
  const db = await getDb();
  return db.select().from(schema.deviceServices).where(eq(schema.deviceServices.deviceId, deviceId)).orderBy(schema.deviceServices.displayName, schema.deviceServices.name);
}

export async function deviceLocalUsers(deviceId: string) {
  const db = await getDb();
  return db.select().from(schema.deviceLocalUsers).where(eq(schema.deviceLocalUsers.deviceId, deviceId)).orderBy(desc(schema.deviceLocalUsers.isAdmin), schema.deviceLocalUsers.username);
}

export type TelemetryRange = "1h" | "6h" | "24h" | "7d";
const RANGE_MS: Record<TelemetryRange, number> = { "1h": 3600_000, "6h": 6 * 3600_000, "24h": 86400_000, "7d": 7 * 86400_000 };

/** Telemetry samples for a window, thinned to at most ~600 points so charts stay light. */
export async function deviceTelemetry(deviceId: string, range: TelemetryRange) {
  const db = await getDb();
  const since = new Date(Date.now() - RANGE_MS[range]);
  const rows = await db
    .select({ ts: schema.telemetry.ts, cpuPercent: schema.telemetry.cpuPercent, memUsedBytes: schema.telemetry.memUsedBytes, memTotalBytes: schema.telemetry.memTotalBytes, disks: schema.telemetry.disks, netRxBps: schema.telemetry.netRxBps, netTxBps: schema.telemetry.netTxBps, uptimeSeconds: schema.telemetry.uptimeSeconds, processCount: schema.telemetry.processCount, loadAvg: schema.telemetry.loadAvg, batteryPercent: schema.telemetry.batteryPercent, topProcesses: schema.telemetry.topProcesses, temperatures: schema.telemetry.temperatures })
    .from(schema.telemetry)
    .where(and(eq(schema.telemetry.deviceId, deviceId), gte(schema.telemetry.ts, since)))
    .orderBy(schema.telemetry.ts);
  const step = Math.ceil(rows.length / 600);
  return { range, since: since.toISOString(), samples: step > 1 ? rows.filter((_, i) => i % step === 0 || i === rows.length - 1) : rows };
}

export interface TimelineEntry {
  id: string;
  ts: string;
  kind: "event" | "software" | "job" | "alert";
  severity: "info" | "warning" | "error" | "critical";
  title: string;
  detail?: string | null;
  href?: string;
  data?: Record<string, unknown>;
}

/**
 * Unified device timeline: device events, software installs/removals, job runs and alerts merged by time.
 * Answers "what changed on this device before the incident" without visiting four screens.
 */
export async function deviceTimeline(deviceId: string, orgId: string, opts: { before?: Date; limit?: number } = {}): Promise<TimelineEntry[]> {
  const db = await getDb();
  const limit = Math.min(opts.limit ?? 60, 200);
  const before = opts.before ?? new Date(Date.now() + 60_000);
  const [events, installed, removed, runs, alerts] = await Promise.all([
    db.select().from(schema.deviceEvents).where(and(eq(schema.deviceEvents.deviceId, deviceId), lt(schema.deviceEvents.ts, before))).orderBy(desc(schema.deviceEvents.ts)).limit(limit),
    db.select({ id: schema.deviceSoftware.id, name: schema.deviceSoftware.name, version: schema.deviceSoftware.version, publisher: schema.deviceSoftware.publisher, ts: schema.deviceSoftware.firstSeenAt }).from(schema.deviceSoftware).where(and(eq(schema.deviceSoftware.deviceId, deviceId), lt(schema.deviceSoftware.firstSeenAt, before))).orderBy(desc(schema.deviceSoftware.firstSeenAt)).limit(limit),
    db.select({ id: schema.deviceSoftware.id, name: schema.deviceSoftware.name, version: schema.deviceSoftware.version, publisher: schema.deviceSoftware.publisher, ts: schema.deviceSoftware.removedAt }).from(schema.deviceSoftware).where(and(eq(schema.deviceSoftware.deviceId, deviceId), sql`${schema.deviceSoftware.removedAt} is not null`, lt(schema.deviceSoftware.removedAt, before))).orderBy(desc(schema.deviceSoftware.removedAt)).limit(limit),
    db.select({ id: schema.jobRuns.id, jobId: schema.jobRuns.jobId, status: schema.jobRuns.status, ts: schema.jobRuns.createdAt, finishedAt: schema.jobRuns.finishedAt, exitCode: schema.jobRuns.exitCode, error: schema.jobRuns.error, jobName: schema.jobs.name, jobType: schema.jobs.type, createdByName: schema.jobs.createdByName }).from(schema.jobRuns).innerJoin(schema.jobs, eq(schema.jobs.id, schema.jobRuns.jobId)).where(and(eq(schema.jobRuns.deviceId, deviceId), lt(schema.jobRuns.createdAt, before))).orderBy(desc(schema.jobRuns.createdAt)).limit(limit),
    db.select({ id: schema.alerts.id, title: schema.alerts.title, severity: schema.alerts.severity, status: schema.alerts.status, ts: schema.alerts.openedAt, resolvedAt: schema.alerts.resolvedAt, occurrences: schema.alerts.occurrences }).from(schema.alerts).where(and(eq(schema.alerts.deviceId, deviceId), eq(schema.alerts.orgId, orgId), lt(schema.alerts.openedAt, before))).orderBy(desc(schema.alerts.openedAt)).limit(limit),
  ]);
  const out: TimelineEntry[] = [];
  for (const e of events) out.push({ id: `ev-${e.id}`, ts: e.ts.toISOString(), kind: "event", severity: e.severity, title: e.message, detail: e.type, data: { source: e.source, ...e.data } });
  // A full inventory (first contact, re-enrol) marks hundreds of packages at once; show those as one entry per
  // minute instead of flooding the timeline, but keep individual lines for the handful of real changes.
  const bucketed = (rows: { id: string; name: string; version: string | null; publisher: string | null; ts: Date | null }[], verb: "Installed" | "Removed") => {
    const byMinute = new Map<string, typeof rows>();
    for (const r of rows) {
      if (!r.ts) continue;
      const k = r.ts.toISOString().slice(0, 16);
      byMinute.set(k, [...(byMinute.get(k) ?? []), r]);
    }
    for (const [, group] of byMinute) {
      if (group.length > 8) {
        const ts = group[0].ts!.toISOString();
        out.push({ id: `sw-bulk-${verb}-${ts}`, ts, kind: "software", severity: "info", title: `${group.length} packages ${verb.toLowerCase()} (inventory)`, detail: group.slice(0, 5).map((s) => s.name).join(", ") + (group.length > 5 ? ", …" : ""), data: { count: group.length } });
      } else {
        for (const s of group) out.push({ id: `sw${verb === "Installed" ? "+" : "-"}${s.id}`, ts: s.ts!.toISOString(), kind: "software", severity: "info", title: `${verb} ${s.name}${s.version ? ` ${s.version}` : ""}`, detail: s.publisher });
      }
    }
  };
  bucketed(installed, "Installed");
  bucketed(removed, "Removed");
  for (const r of runs) {
    const failed = r.status === "failed" || r.status === "timeout";
    out.push({ id: `run-${r.id}`, ts: r.ts.toISOString(), kind: "job", severity: failed ? "error" : "info", title: `${r.jobName}`, detail: `${r.jobType} · ${r.status}${r.exitCode !== null && r.exitCode !== undefined ? ` · exit ${r.exitCode}` : ""}${r.createdByName ? ` · by ${r.createdByName}` : ""}`, href: `/jobs/${r.jobId}?run=${r.id}`, data: { status: r.status, error: r.error } });
  }
  for (const a of alerts) {
    const sev = a.severity === "critical" ? "critical" : a.severity === "high" ? "error" : a.severity === "medium" ? "warning" : "info";
    out.push({ id: `al-${a.id}`, ts: a.ts.toISOString(), kind: "alert", severity: sev, title: a.title, detail: `${a.severity} · ${a.status}${a.occurrences > 1 ? ` · ${a.occurrences}×` : ""}`, href: `/alerts/${a.id}` });
  }
  out.sort((x, y) => (x.ts < y.ts ? 1 : x.ts > y.ts ? -1 : 0));
  return out.slice(0, limit);
}

export async function deviceJobRuns(deviceId: string, limit = 50) {
  const db = await getDb();
  return db
    .select({ id: schema.jobRuns.id, jobId: schema.jobRuns.jobId, status: schema.jobRuns.status, createdAt: schema.jobRuns.createdAt, finishedAt: schema.jobRuns.finishedAt, exitCode: schema.jobRuns.exitCode, error: schema.jobRuns.error, durationMs: schema.jobRuns.durationMs, jobName: schema.jobs.name, jobType: schema.jobs.type, createdByName: schema.jobs.createdByName, payload: schema.jobs.payload })
    .from(schema.jobRuns)
    .innerJoin(schema.jobs, eq(schema.jobs.id, schema.jobRuns.jobId))
    .where(eq(schema.jobRuns.deviceId, deviceId))
    .orderBy(desc(schema.jobRuns.createdAt))
    .limit(limit);
}
