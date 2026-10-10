import { describe, expect, it } from "vitest";
import { buildRecurrence, nextOccurrence, occurrencesBetween, parseRecurrence, windowActiveAt } from "./maintenance";

const win = (over: Partial<{ startsAt: Date; endsAt: Date; recurrence: string | null; timezone: string }> = {}) => ({
  startsAt: new Date("2026-03-01T02:00:00Z"), endsAt: new Date("2026-03-01T04:00:00Z"), recurrence: null as string | null, timezone: "UTC", ...over,
});

describe("maintenance recurrence", () => {
  it("parses and round-trips RRULEs", () => {
    const r = parseRecurrence("RRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=SU,SA;BYHOUR=2;BYMINUTE=30");
    expect(r).toEqual({ freq: "WEEKLY", interval: 2, byDay: [0, 6], byHour: 2, byMinute: 30 });
    expect(buildRecurrence(r!)).toBe("FREQ=WEEKLY;INTERVAL=2;BYDAY=SU,SA;BYHOUR=2;BYMINUTE=30");
    expect(parseRecurrence("FREQ=HOURLY")).toBeNull();
    expect(parseRecurrence("")).toBeNull();
  });
  it("one-off windows are active only between start and end", () => {
    const w = win();
    expect(windowActiveAt(w, new Date("2026-03-01T03:00:00Z"))).toEqual({ start: w.startsAt, end: w.endsAt });
    expect(windowActiveAt(w, new Date("2026-03-01T04:00:00Z"))).toBeNull();
    expect(nextOccurrence(w, new Date("2026-02-01T00:00:00Z"))?.toISOString()).toBe("2026-03-01T02:00:00.000Z");
    expect(nextOccurrence(w, new Date("2026-04-01T00:00:00Z"))).toBeNull();
  });
  it("weekly windows recur on the anchor weekday with the anchor duration", () => {
    const w = win({ recurrence: "FREQ=WEEKLY" }); // 2026-03-01 is a Sunday
    expect(windowActiveAt(w, new Date("2026-03-08T02:30:00Z"))?.start.toISOString()).toBe("2026-03-08T02:00:00.000Z");
    expect(windowActiveAt(w, new Date("2026-03-09T02:30:00Z"))).toBeNull();
    expect(windowActiveAt(w, new Date("2026-03-08T04:00:00Z"))).toBeNull();
  });
  it("supports BYDAY lists and daily intervals", () => {
    const w = win({ recurrence: "FREQ=WEEKLY;BYDAY=MO,WE" });
    const starts = occurrencesBetween(w, new Date("2026-03-01T00:00:00Z"), new Date("2026-03-14T00:00:00Z"));
    expect(starts.map((d) => d.toISOString().slice(0, 10))).toEqual(["2026-03-02", "2026-03-04", "2026-03-09", "2026-03-11"]);
    const daily = win({ recurrence: "FREQ=DAILY;INTERVAL=3" });
    expect(occurrencesBetween(daily, new Date("2026-03-01T00:00:00Z"), new Date("2026-03-10T03:00:00Z")).map((d) => d.toISOString().slice(0, 10))).toEqual(["2026-03-01", "2026-03-04", "2026-03-07", "2026-03-10"]);
  });
  it("keeps the local wall-clock time across DST in the window timezone", () => {
    const w = win({ startsAt: new Date("2026-03-01T07:00:00Z"), endsAt: new Date("2026-03-01T09:00:00Z"), recurrence: "FREQ=DAILY", timezone: "America/New_York" }); // 02:00 local
    // after DST starts (Mar 8) 02:00 EDT = 06:00Z
    expect(windowActiveAt(w, new Date("2026-03-10T06:30:00Z"))?.start.toISOString()).toBe("2026-03-10T06:00:00.000Z");
    expect(windowActiveAt(w, new Date("2026-03-10T08:30:00Z"))).toBeNull();
  });
  it("respects UNTIL and monthly BYMONTHDAY", () => {
    const w = win({ recurrence: "FREQ=MONTHLY;BYMONTHDAY=1,15;UNTIL=20260420T000000Z" });
    const starts = occurrencesBetween(w, new Date("2026-03-01T00:00:00Z"), new Date("2026-06-01T00:00:00Z"));
    expect(starts.map((d) => d.toISOString().slice(0, 10))).toEqual(["2026-03-01", "2026-03-15", "2026-04-01", "2026-04-15"]);
  });
});
