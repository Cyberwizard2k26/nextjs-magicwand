import { describe, expect, it } from "vitest";
import { cronMatches, describeCron, fromZoned, nextRun, nextRuns, parseCron, tzOffsetMinutes, validateCron, zonedParts } from "./cron";

const at = (iso: string) => new Date(iso);

describe("parseCron", () => {
  it("parses stars, steps, ranges, lists and names", () => {
    const s = parseCron("*/15 9-17 1,15 jan-mar mon-fri");
    expect([...s.minutes]).toEqual([0, 15, 30, 45]);
    expect([...s.hours]).toEqual([9, 10, 11, 12, 13, 14, 15, 16, 17]);
    expect([...s.daysOfMonth]).toEqual([1, 15]);
    expect([...s.months]).toEqual([1, 2, 3]);
    expect([...s.daysOfWeek]).toEqual([1, 2, 3, 4, 5]);
    expect(s.domRestricted && s.dowRestricted).toBe(true);
  });
  it("maps 7 to Sunday and expands macros", () => {
    expect([...parseCron("0 0 * * 7").daysOfWeek]).toEqual([0]);
    expect([...parseCron("@weekly").daysOfWeek]).toEqual([0]);
    expect([...parseCron("@hourly").minutes]).toEqual([0]);
  });
  it("rejects bad expressions with readable errors", () => {
    expect(validateCron("* * * *")).toMatch(/5 fields/);
    expect(validateCron("60 * * * *")).toMatch(/out of range/);
    expect(validateCron("*/0 * * * *")).toMatch(/invalid step/);
    expect(validateCron("5-1 * * * *")).toMatch(/reversed/);
    expect(validateCron("a * * * *")).toMatch(/not a number/);
    expect(validateCron("0 2 * * *")).toBeNull();
  });
});

describe("nextRun", () => {
  it("finds the next minute for every-minute schedules", () => {
    expect(nextRun("* * * * *", at("2026-03-10T10:15:30Z"))?.toISOString()).toBe("2026-03-10T10:16:00.000Z");
  });
  it("rolls over hours, days, months and years", () => {
    expect(nextRun("0 2 * * *", at("2026-03-10T03:00:00Z"))?.toISOString()).toBe("2026-03-11T02:00:00.000Z");
    expect(nextRun("30 23 31 12 *", at("2026-12-31T23:31:00Z"))?.toISOString()).toBe("2027-12-31T23:30:00.000Z");
    expect(nextRun("0 0 29 2 *", at("2026-01-01T00:00:00Z"))?.toISOString()).toBe("2028-02-29T00:00:00.000Z");
  });
  it("uses Vixie semantics when both day fields are restricted", () => {
    // 2026-03-10 is a Tuesday; "1st of the month OR Monday" from a Tuesday => next Monday the 16th
    expect(nextRun("0 9 1 * 1", at("2026-03-10T10:00:00Z"))?.toISOString()).toBe("2026-03-16T09:00:00.000Z");
    // weekdays only
    expect(nextRun("0 8 * * 1-5", at("2026-03-13T09:00:00Z"))?.toISOString()).toBe("2026-03-16T08:00:00.000Z");
  });
  it("evaluates in the requested timezone, including DST changes", () => {
    // New York switches to EDT on 2026-03-08 at 02:00. 02:30 local does not exist that day -> skip to 03:30? No: skip to next day's 02:30.
    const n = nextRun("30 2 * * *", at("2026-03-08T05:00:00Z"), "America/New_York");
    expect(n?.toISOString()).toBe("2026-03-09T06:30:00.000Z");
    // Daily at 09:00 Berlin in summer is 07:00Z
    expect(nextRun("0 9 * * *", at("2026-07-01T00:00:00Z"), "Europe/Berlin")?.toISOString()).toBe("2026-07-01T07:00:00.000Z");
    // and 08:00Z in winter
    expect(nextRun("0 9 * * *", at("2026-01-01T00:00:00Z"), "Europe/Berlin")?.toISOString()).toBe("2026-01-01T08:00:00.000Z");
  });
  it("returns the requested number of upcoming runs", () => {
    const runs = nextRuns("*/20 * * * *", 4, at("2026-03-10T10:00:00Z"));
    expect(runs.map((d) => d.toISOString())).toEqual(["2026-03-10T10:20:00.000Z", "2026-03-10T10:40:00.000Z", "2026-03-10T11:00:00.000Z", "2026-03-10T11:20:00.000Z"]);
  });
  it("returns null when nothing can ever match within the horizon", () => {
    expect(nextRun("0 0 30 2 *", at("2026-01-01T00:00:00Z"))).toBeNull();
  });
  it("matches instants at minute precision", () => {
    expect(cronMatches("0 2 * * *", at("2026-03-10T02:00:59Z"))).toBe(true);
    expect(cronMatches("0 2 * * *", at("2026-03-10T02:01:00Z"))).toBe(false);
  });
});

describe("timezone helpers", () => {
  it("computes offsets and wall-clock parts", () => {
    expect(tzOffsetMinutes(at("2026-07-01T12:00:00Z"), "Europe/Berlin")).toBe(120);
    expect(tzOffsetMinutes(at("2026-01-01T12:00:00Z"), "America/New_York")).toBe(-300);
    const p = zonedParts(at("2026-07-01T12:34:00Z"), "Asia/Kolkata");
    expect([p.hour, p.minute]).toEqual([18, 4]);
  });
  it("converts wall-clock to instants and detects DST gaps", () => {
    expect(fromZoned({ year: 2026, month: 7, day: 1, hour: 9, minute: 0 }, "Europe/Berlin")?.toISOString()).toBe("2026-07-01T07:00:00.000Z");
    expect(fromZoned({ year: 2026, month: 3, day: 8, hour: 2, minute: 30 }, "America/New_York")).toBeNull();
  });
});

describe("describeCron", () => {
  it("humanises common schedules", () => {
    expect(describeCron("* * * * *")).toBe("Every minute");
    expect(describeCron("*/5 * * * *")).toBe("Every 5 minutes");
    expect(describeCron("0 * * * *")).toBe("Every hour");
    expect(describeCron("0 2 * * *")).toBe("Daily at 02:00");
    expect(describeCron("0 8 * * 1-5")).toBe("At 08:00 on weekdays");
    expect(describeCron("0 3 * * 0")).toBe("Weekly on Sunday at 03:00");
    expect(describeCron("0 4 1 * *")).toBe("Monthly on the 1st at 04:00");
    expect(describeCron("0 */6 * * *")).toBe("Every 6 hours");
    expect(describeCron("bad")).toMatch(/Invalid schedule/);
  });
});
