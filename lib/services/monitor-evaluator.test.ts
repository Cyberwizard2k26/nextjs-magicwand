import { describe, expect, it } from "vitest";
import { advanceState, buildProbeScript, compareThreshold, evaluateTelemetrySample, finaliseProbe, parseProbeOutput, type StateLike } from "./monitor-evaluator";
import { dueStep } from "./escalation";
import { inQuietHours } from "./notification-channels";

describe("compareThreshold", () => {
  it("applies operators and ranks critical above warning", () => {
    expect(compareThreshold(96, { warning: 85, critical: 95 })).toBe("critical");
    expect(compareThreshold(90, { warning: 85, critical: 95 })).toBe("warning");
    expect(compareThreshold(10, { warning: 85, critical: 95 })).toBe("ok");
    expect(compareThreshold(5, { warning: 30, critical: 7, op: "<" })).toBe("critical");
    expect(compareThreshold(20, { warning: 30, critical: 7, op: "<" })).toBe("warning");
    expect(compareThreshold(null, { warning: 1 })).toBe("unknown");
    expect(compareThreshold(3, {}, ">")).toBe("ok");
  });
});

describe("evaluateTelemetrySample", () => {
  const disk = { type: "disk_space" as const, config: { minSizeBytes: 1_000_000_000 }, thresholds: { warning: 85, critical: 90, op: ">" as const } };
  it("picks the fullest qualifying volume", () => {
    const r = evaluateTelemetrySample(disk, { disks: [{ mount: "/", usedBytes: 92e9, totalBytes: 100e9 }, { mount: "/boot", usedBytes: 9e8, totalBytes: 9.5e8 }, { mount: "/data", usedBytes: 10e9, totalBytes: 100e9 }] });
    expect(r.status).toBe("critical");
    expect(r.value).toBe(92);
    expect(r.message).toContain("/");
  });
  it("honours an explicit mount list and reports missing mounts as unknown", () => {
    const r = evaluateTelemetrySample({ ...disk, config: { mounts: ["D:"] } }, { disks: [{ mount: "C:", usedBytes: 95e9, totalBytes: 100e9 }] });
    expect(r.status).toBe("unknown");
  });
  it("computes memory percentage and cpu", () => {
    expect(evaluateTelemetrySample({ type: "memory", config: {}, thresholds: { warning: 80, critical: 90 } }, { memUsedBytes: 85, memTotalBytes: 100 }).status).toBe("warning");
    expect(evaluateTelemetrySample({ type: "cpu", config: {}, thresholds: { warning: 80, critical: 90 } }, { cpuPercent: 12.34 }).value).toBe(12.3);
    expect(evaluateTelemetrySample({ type: "battery", config: {}, thresholds: { warning: 20, critical: 10, op: "<" } }, { batteryPercent: null }).status).toBe("ok");
  });
});

describe("advanceState", () => {
  const t0 = new Date("2026-03-10T10:00:00Z");
  const plus = (s: number) => new Date(t0.getTime() + s * 1000);
  const crit = { status: "critical" as const, value: 99, message: "hot" };
  const ok = { status: "ok" as const, value: 1, message: "fine" };
  it("alerts immediately without flap settings", () => {
    const r = advanceState(null, crit, t0, {});
    expect(r.transition).toBe("alert");
    expect(r.next.consecutiveFailures).toBe(1);
  });
  it("waits for consecutive failures and sustained duration", () => {
    let s: StateLike | null = null;
    let r = advanceState(s, crit, t0, { consecutive: 3, durationSeconds: 600 });
    expect(r.transition).toBe("none");
    s = r.next;
    r = advanceState(s, crit, plus(60), { consecutive: 3, durationSeconds: 600 });
    expect(r.transition).toBe("none");
    s = r.next;
    r = advanceState(s, crit, plus(120), { consecutive: 3, durationSeconds: 600 }); // 3rd failure but only 2 min
    expect(r.transition).toBe("none");
    s = r.next;
    r = advanceState(s, crit, plus(601), { consecutive: 3, durationSeconds: 600 });
    expect(r.transition).toBe("alert");
    expect(r.next.failingSince?.toISOString()).toBe(t0.toISOString());
  });
  it("resets when an ok result arrives before alerting", () => {
    const s = advanceState(null, crit, t0, { consecutive: 2 }).next;
    const r = advanceState(s, ok, plus(30), { consecutive: 2 });
    expect(r.transition).toBe("none");
    expect(r.next.consecutiveFailures).toBe(0);
    expect(r.next.status).toBe("ok");
  });
  it("recovers an alerting state after the auto-resolve delay", () => {
    const alerting: StateLike = { status: "critical", consecutiveFailures: 3, failingSince: t0, lastOkAt: null, alertId: "a1", data: {} };
    let r = advanceState(alerting, ok, plus(10), {}, 300);
    expect(r.transition).toBe("none");
    expect(r.alerting).toBe(true);
    r = advanceState(r.next, ok, plus(320), {}, 300);
    expect(r.transition).toBe("recover");
    expect(r.next.alertId).toBeNull();
    expect(r.next.status).toBe("ok");
  });
  it("escalates warning to critical on an open alert and ignores unknown", () => {
    const warn: StateLike = { status: "warning", consecutiveFailures: 2, failingSince: t0, lastOkAt: null, alertId: "a1", data: {} };
    expect(advanceState(warn, crit, plus(5), {}).transition).toBe("worsen");
    const r = advanceState(warn, { status: "unknown", value: null, message: "n/a" }, plus(5), {});
    expect(r.transition).toBe("none");
    expect(r.next.alertId).toBe("a1");
  });
});

describe("probe scripts and output", () => {
  it("generates bash and powershell for every probe type", () => {
    const cfg: Record<string, Record<string, unknown>> = { service: { names: ["ssh", "cron"] }, process: { name: "nginx" }, port: { host: "127.0.0.1", port: 22 }, ping: { host: "1.1.1.1" }, http: { url: "https://example.com", expectStatus: 200, bodyContains: "ok" }, dns: { hostname: "example.com" }, cert_expiry: { host: "example.com", port: 443 }, eventlog: { logName: "System", level: "error", minutes: 15 }, file_exists: { path: "/tmp/x" }, file_size: { path: "/var/log" }, backup_status: { path: "/backup" } };
    for (const [type, c] of Object.entries(cfg)) {
      const b = buildProbeScript(type, c, "linux");
      const w = buildProbeScript(type, c, "windows");
      expect(b?.language, type).toBe("bash");
      expect(w?.language, type).toBe("powershell");
      expect(b!.content).toContain("value");
      expect(w!.content).toContain("ConvertTo-Json");
    }
    expect(buildProbeScript("script", {}, "linux")).toBeNull();
  });
  it("quotes shell arguments safely", () => {
    const b = buildProbeScript("file_exists", { path: "/tmp/it's here" }, "linux")!;
    expect(b.content).toContain(`'/tmp/it'\\''s here'`);
    const w = buildProbeScript("file_exists", { path: "C:\\it's" }, "windows")!;
    expect(w.content).toContain("'C:\\it''s'");
  });
  it("parses structured output or the last JSON stdout line", () => {
    expect(parseProbeOutput({ value: 3, message: "three" })).toMatchObject({ value: 3, message: "three", status: "unknown" });
    expect(parseProbeOutput(null, 'noise\n{"value":"12.5","status":"ok","message":"m"}\n')).toMatchObject({ value: 12.5, status: "ok" });
    expect(parseProbeOutput(null, "garbage")).toBeNull();
    expect(parseProbeOutput({ days: 4 }, null, "days")?.value).toBe(4);
  });
  it("combines probe verdicts with numeric thresholds", () => {
    const m = { type: "ping" as const, thresholds: { warning: 100, critical: 300, op: ">" as const } };
    expect(finaliseProbe(m, { status: "unknown", value: 350, message: "", data: {} }).status).toBe("critical");
    expect(finaliseProbe(m, { status: "critical", value: null, message: "unreachable", data: { status: "critical" } }).status).toBe("critical");
    expect(finaliseProbe({ type: "service", thresholds: {} }, { status: "ok", value: 0, message: "", data: { status: "ok" } }).status).toBe("ok");
    expect(finaliseProbe({ type: "service", thresholds: {} }, null, "boom").status).toBe("unknown");
  });
});

describe("escalation steps", () => {
  const policy = { steps: [{ afterMinutes: 10, channelIds: ["a"] }, { afterMinutes: 30, channelIds: ["b"], repeat: true }], repeatCount: 2 };
  it("fires steps in order as time passes", () => {
    expect(dueStep(policy, 0, 5)).toBeNull();
    expect(dueStep(policy, 0, 10)?.index).toBe(0);
    expect(dueStep(policy, 1, 20)).toBeNull();
    expect(dueStep(policy, 1, 31)?.index).toBe(1);
  });
  it("repeats the last step with the policy gap and stops at repeatCount", () => {
    expect(dueStep(policy, 2, 40)).toBeNull();
    expect(dueStep(policy, 2, 50)?.index).toBe(2);
    expect(dueStep(policy, 3, 70)?.index).toBe(3);
    expect(dueStep(policy, 4, 500)).toBeNull();
  });
});

describe("quiet hours", () => {
  it("handles same-day and overnight ranges in a timezone", () => {
    expect(inQuietHours({ start: "22:00", end: "07:00" }, new Date("2026-03-10T23:30:00Z"), "UTC")).toBe(true);
    expect(inQuietHours({ start: "22:00", end: "07:00" }, new Date("2026-03-10T12:00:00Z"), "UTC")).toBe(false);
    expect(inQuietHours({ start: "09:00", end: "17:00", days: [1, 2, 3, 4, 5] }, new Date("2026-03-14T12:00:00Z"), "UTC")).toBe(false); // Saturday
    expect(inQuietHours({ start: "22:00", end: "07:00" }, new Date("2026-03-10T02:00:00Z"), "Europe/Berlin")).toBe(true);
    expect(inQuietHours(null, new Date())).toBe(false);
  });
});
