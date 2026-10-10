/**
 * Dependency-free 5-field cron (minute hour day-of-month month day-of-week) with timezone-aware next-run
 * computation, previews and a human description. Used by schedules, automations (cron trigger), monitors
 * and reports. Pure functions: safe to import from modules loaded at boot and from the browser.
 *
 * Supported syntax: `*`, `n`, `a-b`, `*​/s`, `a-b/s`, lists `a,b,c`, `?` (same as `*`), month and weekday
 * names (jan..dec, sun..sat), `7` for Sunday and the macros @hourly @daily @midnight @weekly @monthly @yearly.
 * Day-of-month / day-of-week follow Vixie cron: when both are restricted a date matches if either matches.
 */

export interface CronSpec {
  minutes: Set<number>;
  hours: Set<number>;
  daysOfMonth: Set<number>;
  months: Set<number>;
  daysOfWeek: Set<number>;
  domRestricted: boolean;
  dowRestricted: boolean;
  source: string;
}

const MACROS: Record<string, string> = {
  "@hourly": "0 * * * *",
  "@daily": "0 0 * * *",
  "@midnight": "0 0 * * *",
  "@weekly": "0 0 * * 0",
  "@monthly": "0 0 1 * *",
  "@yearly": "0 0 1 1 *",
  "@annually": "0 0 1 1 *",
};
const MONTH_NAMES = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const DAY_NAMES = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

export class CronError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CronError";
  }
}

function parseField(raw: string, min: number, max: number, names: string[] | null, label: string): { values: Set<number>; restricted: boolean } {
  const out = new Set<number>();
  let restricted = false;
  const field = raw.trim().toLowerCase();
  if (!field) throw new CronError(`${label}: empty field`);
  for (const part of field.split(",")) {
    if (!part) throw new CronError(`${label}: empty list item`);
    const [rangePart, stepPart] = part.split("/");
    if (part.includes("/") && (stepPart === undefined || stepPart === "")) throw new CronError(`${label}: missing step in "${part}"`);
    const step = stepPart !== undefined ? Number(stepPart) : 1;
    if (!Number.isInteger(step) || step < 1) throw new CronError(`${label}: invalid step "${stepPart}"`);
    let lo: number;
    let hi: number;
    if (rangePart === "*" || rangePart === "?") {
      lo = min;
      hi = max;
      if (stepPart !== undefined) restricted = true;
    } else {
      restricted = true;
      const [a, b] = rangePart.split("-");
      lo = parseValue(a, min, max, names, label);
      hi = b !== undefined ? parseValue(b, min, max, names, label) : stepPart !== undefined ? max : lo;
      if (b === "") throw new CronError(`${label}: invalid range "${rangePart}"`);
      if (hi < lo) throw new CronError(`${label}: range "${rangePart}" is reversed`);
    }
    for (let v = lo; v <= hi; v += step) out.add(v === 7 && label === "day-of-week" ? 0 : v);
  }
  return { values: out, restricted };
}

function parseValue(v: string, min: number, max: number, names: string[] | null, label: string): number {
  if (v === undefined || v === "") throw new CronError(`${label}: missing value`);
  if (names) {
    const idx = names.indexOf(v.slice(0, 3));
    if (idx >= 0 && /^[a-z]+$/.test(v)) return idx + (label === "month" ? 1 : 0);
  }
  if (!/^\d+$/.test(v)) throw new CronError(`${label}: "${v}" is not a number`);
  const n = Number(v);
  if (n < min || n > max) throw new CronError(`${label}: ${n} is out of range ${min}-${max}`);
  return n;
}

/** Parse a cron expression; throws CronError with a readable message. */
export function parseCron(expression: string): CronSpec {
  const trimmed = (expression ?? "").trim();
  const expr = MACROS[trimmed.toLowerCase()] ?? trimmed;
  const fields = expr.split(/\s+/).filter(Boolean);
  if (fields.length !== 5) throw new CronError(`Expected 5 fields (minute hour day month weekday), got ${fields.length}`);
  const minutes = parseField(fields[0], 0, 59, null, "minute");
  const hours = parseField(fields[1], 0, 23, null, "hour");
  const dom = parseField(fields[2], 1, 31, null, "day-of-month");
  const months = parseField(fields[3], 1, 12, MONTH_NAMES, "month");
  const dow = parseField(fields[4], 0, 7, DAY_NAMES, "day-of-week");
  return { minutes: minutes.values, hours: hours.values, daysOfMonth: dom.values, months: months.values, daysOfWeek: dow.values, domRestricted: dom.restricted, dowRestricted: dow.restricted, source: trimmed };
}

/** null when valid, otherwise the error message. */
export function validateCron(expression: string): string | null {
  try {
    parseCron(expression);
    return null;
  } catch (err) {
    return err instanceof CronError ? err.message : String(err);
  }
}

export function isValidTimezone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------------ timezone helpers */

interface WallClock { year: number; month: number; day: number; hour: number; minute: number; second: number; weekday: number }

const dtfCache = new Map<string, Intl.DateTimeFormat>();
function dtf(tz: string): Intl.DateTimeFormat {
  let f = dtfCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", second: "numeric", weekday: "short" });
    dtfCache.set(tz, f);
  }
  return f;
}

/** Wall-clock components of an instant in a timezone. */
export function zonedParts(date: Date, tz: string): WallClock {
  const parts = dtf(tz).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "0";
  const hour = Number(get("hour")) % 24;
  return { year: Number(get("year")), month: Number(get("month")), day: Number(get("day")), hour, minute: Number(get("minute")), second: Number(get("second")), weekday: DAY_NAMES.indexOf(get("weekday").toLowerCase().slice(0, 3)) };
}

/** Offset (minutes east of UTC) of a timezone at an instant. */
export function tzOffsetMinutes(date: Date, tz: string): number {
  const p = zonedParts(date, tz);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return Math.round((asUtc - date.getTime()) / 60_000);
}

/**
 * Instant for a wall-clock time in a timezone. Returns null when that wall-clock time does not exist
 * (DST spring-forward gap); picks the earlier instant when it is ambiguous (fall-back overlap).
 */
export function fromZoned(wc: { year: number; month: number; day: number; hour: number; minute: number }, tz: string): Date | null {
  const target = Date.UTC(wc.year, wc.month - 1, wc.day, wc.hour, wc.minute, 0);
  let guess = target - tzOffsetMinutes(new Date(target), tz) * 60_000;
  for (let i = 0; i < 3; i++) {
    const off = tzOffsetMinutes(new Date(guess), tz);
    const next = target - off * 60_000;
    if (next === guess) break;
    guess = next;
  }
  const check = zonedParts(new Date(guess), tz);
  if (check.year !== wc.year || check.month !== wc.month || check.day !== wc.day || check.hour !== wc.hour || check.minute !== wc.minute) {
    // Try the alternative offset (an hour earlier / later) before giving up.
    for (const delta of [-60, 60, -30, 30]) {
      const alt = guess + delta * 60_000;
      const c = zonedParts(new Date(alt), tz);
      if (c.year === wc.year && c.month === wc.month && c.day === wc.day && c.hour === wc.hour && c.minute === wc.minute) return new Date(alt);
    }
    return null;
  }
  // Ambiguous (fall back): prefer the earlier instant.
  const earlier = guess - 3600_000;
  const e = zonedParts(new Date(earlier), tz);
  if (e.year === wc.year && e.month === wc.month && e.day === wc.day && e.hour === wc.hour && e.minute === wc.minute) return new Date(earlier);
  return new Date(guess);
}

/* ------------------------------------------------------------------ next run */

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}
function weekdayOf(year: number, month: number, day: number): number {
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

function dayMatches(spec: CronSpec, year: number, month: number, day: number): boolean {
  const domOk = spec.daysOfMonth.has(day);
  const dowOk = spec.daysOfWeek.has(weekdayOf(year, month, day));
  if (spec.domRestricted && spec.dowRestricted) return domOk || dowOk;
  if (spec.domRestricted) return domOk;
  if (spec.dowRestricted) return dowOk;
  return true;
}

function firstAtLeast(set: Set<number>, min: number): number | null {
  let best: number | null = null;
  for (const v of set) if (v >= min && (best === null || v < best)) best = v;
  return best;
}

/**
 * Next instant strictly after `from` matching the expression, evaluated in `tz` (IANA name, default UTC).
 * Returns null when nothing matches within ~5 years (e.g. "0 0 30 2 *").
 */
export function nextRun(expression: string | CronSpec, from: Date = new Date(), tz = "UTC"): Date | null {
  const spec = typeof expression === "string" ? parseCron(expression) : expression;
  const zone = isValidTimezone(tz) ? tz : "UTC";
  const start = new Date(Math.floor(from.getTime() / 60_000) * 60_000 + 60_000);
  const p = zonedParts(start, zone);
  let year = p.year, month = p.month, day = p.day, hour = p.hour, minute = p.minute;
  const limitYear = p.year + 5;
  let guard = 0;
  while (year <= limitYear && guard++ < 200_000) {
    if (!spec.months.has(month)) {
      month++;
      if (month > 12) { month = 1; year++; }
      day = 1; hour = 0; minute = 0;
      continue;
    }
    if (day > daysInMonth(year, month) || !dayMatches(spec, year, month, day)) {
      day++;
      hour = 0; minute = 0;
      if (day > daysInMonth(year, month)) { day = 1; month++; if (month > 12) { month = 1; year++; } }
      continue;
    }
    const h = firstAtLeast(spec.hours, hour);
    if (h === null) { day++; hour = 0; minute = 0; if (day > daysInMonth(year, month)) { day = 1; month++; if (month > 12) { month = 1; year++; } } continue; }
    if (h !== hour) { hour = h; minute = 0; }
    const m = firstAtLeast(spec.minutes, minute);
    if (m === null) { hour++; minute = 0; if (hour > 23) { hour = 0; day++; if (day > daysInMonth(year, month)) { day = 1; month++; if (month > 12) { month = 1; year++; } } } continue; }
    minute = m;
    const instant = fromZoned({ year, month, day, hour, minute }, zone);
    if (instant && instant.getTime() > from.getTime()) return instant;
    // Non-existent wall-clock time (DST gap) or not after `from`: move on one minute.
    minute++;
    if (minute > 59) { minute = 0; hour++; if (hour > 23) { hour = 0; day++; if (day > daysInMonth(year, month)) { day = 1; month++; if (month > 12) { month = 1; year++; } } } }
  }
  return null;
}

/** The next `count` runs after `from`. */
export function nextRuns(expression: string | CronSpec, count = 5, from: Date = new Date(), tz = "UTC"): Date[] {
  const spec = typeof expression === "string" ? parseCron(expression) : expression;
  const out: Date[] = [];
  let cursor = from;
  for (let i = 0; i < count; i++) {
    const n = nextRun(spec, cursor, tz);
    if (!n) break;
    out.push(n);
    cursor = n;
  }
  return out;
}

/** Does the expression match the given instant (minute precision) in tz? */
export function cronMatches(expression: string | CronSpec, at: Date, tz = "UTC"): boolean {
  const spec = typeof expression === "string" ? parseCron(expression) : expression;
  const p = zonedParts(at, isValidTimezone(tz) ? tz : "UTC");
  return spec.minutes.has(p.minute) && spec.hours.has(p.hour) && spec.months.has(p.month) && dayMatches(spec, p.year, p.month, p.day);
}

/* ------------------------------------------------------------------ human description */

const DAY_LABELS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTH_LABELS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

function pad(n: number) { return String(n).padStart(2, "0"); }
function sorted(s: Set<number>) { return [...s].sort((a, b) => a - b); }
function isEveryN(values: number[], min: number, max: number): number | null {
  if (values.length < 2) return null;
  const step = values[1] - values[0];
  if (step < 1) return null;
  if (values[0] !== min) return null;
  for (let i = 1; i < values.length; i++) if (values[i] - values[i - 1] !== step) return null;
  if (values[values.length - 1] + step <= max) return null;
  return step;
}
function listWords(items: string[]): string {
  if (items.length <= 1) return items.join("");
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}
function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] || s[v] || s[0]}`;
}
function consecutiveRange(values: number[]): boolean {
  for (let i = 1; i < values.length; i++) if (values[i] - values[i - 1] !== 1) return false;
  return values.length > 2;
}

/** Humanised cadence, e.g. "Every 15 minutes", "Daily at 02:00", "At 09:00 on weekdays", "Monthly on the 1st at 03:30". */
export function describeCron(expression: string): string {
  let spec: CronSpec;
  try { spec = parseCron(expression); } catch (err) { return `Invalid schedule (${err instanceof Error ? err.message : String(err)})`; }
  const minutes = sorted(spec.minutes), hours = sorted(spec.hours), doms = sorted(spec.daysOfMonth), months = sorted(spec.months), dows = sorted(spec.daysOfWeek);
  const allMinutes = minutes.length === 60, allHours = hours.length === 24, allMonths = months.length === 12;

  let timePart: string;
  if (allMinutes && allHours) timePart = "Every minute";
  else if (allHours && minutes.length > 1 && isEveryN(minutes, 0, 59)) timePart = `Every ${isEveryN(minutes, 0, 59)} minutes`;
  else if (allHours && minutes.length === 1) timePart = minutes[0] === 0 ? "Every hour" : `Every hour at :${pad(minutes[0])}`;
  else if (minutes.length === 1 && hours.length > 1 && isEveryN(hours, 0, 23)) timePart = `Every ${isEveryN(hours, 0, 23)} hours${minutes[0] ? ` at :${pad(minutes[0])}` : ""}`;
  else if (minutes.length === 1 && hours.length > 1 && consecutiveRange(hours)) timePart = `Every hour from ${pad(hours[0])}:${pad(minutes[0])} to ${pad(hours[hours.length - 1])}:${pad(minutes[0])}`;
  else if (minutes.length === 1 && hours.length <= 4) timePart = `At ${listWords(hours.map((h) => `${pad(h)}:${pad(minutes[0])}`))}`;
  else if (allHours) timePart = `At minutes ${minutes.slice(0, 6).join(", ")}${minutes.length > 6 ? "…" : ""} past every hour`;
  else if (minutes.length > 1 && hours.length === 1 && isEveryN(minutes, 0, 59)) timePart = `Every ${isEveryN(minutes, 0, 59)} minutes during ${pad(hours[0])}:00–${pad(hours[0])}:59`;
  else timePart = `At ${hours.slice(0, 3).map((h) => `${pad(h)}:${pad(minutes[0])}`).join(", ")}${hours.length > 3 ? "…" : ""}`;

  const dayParts: string[] = [];
  const weekdays = dows.length === 5 && dows.join(",") === "1,2,3,4,5";
  const weekend = dows.length === 2 && dows.join(",") === "0,6";
  if (spec.dowRestricted && dows.length < 7) {
    if (weekdays) dayParts.push("on weekdays");
    else if (weekend) dayParts.push("at weekends");
    else dayParts.push(`on ${listWords(dows.map((d) => DAY_LABELS[d]))}`);
  }
  if (spec.domRestricted && doms.length < 31) {
    dayParts.push(`on the ${listWords(doms.slice(0, 5).map(ordinal))}${doms.length > 5 ? "…" : ""}`);
  }
  const monthPart = !allMonths ? ` in ${listWords(months.slice(0, 4).map((m) => MONTH_LABELS[m - 1]))}${months.length > 4 ? "…" : ""}` : "";
  const dayJoin = spec.domRestricted && spec.dowRestricted ? dayParts.join(" or ") : dayParts.join(" ");

  if (!dayJoin && !monthPart) {
    if (timePart.startsWith("At ") && hours.length === 1 && minutes.length === 1) return `Daily ${timePart.replace(/^At /, "at ")}`;
    return timePart;
  }
  if (spec.dowRestricted && !spec.domRestricted && dows.length === 1 && hours.length === 1 && minutes.length === 1 && allMonths) return `Weekly on ${DAY_LABELS[dows[0]]} at ${pad(hours[0])}:${pad(minutes[0])}`;
  if (spec.domRestricted && !spec.dowRestricted && doms.length === 1 && hours.length === 1 && minutes.length === 1 && allMonths) return `Monthly on the ${ordinal(doms[0])} at ${pad(hours[0])}:${pad(minutes[0])}`;
  return `${timePart} ${dayJoin}${monthPart}`.replace(/\s+/g, " ").trim();
}

/** Presets offered by the schedule editor and the AI. */
export const CRON_PRESETS: { label: string; cron: string; hint: string }[] = [
  { label: "Every 5 minutes", cron: "*/5 * * * *", hint: "Frequent checks" },
  { label: "Every 15 minutes", cron: "*/15 * * * *", hint: "Light polling" },
  { label: "Hourly", cron: "0 * * * *", hint: "At the top of every hour" },
  { label: "Daily at 02:00", cron: "0 2 * * *", hint: "Overnight maintenance" },
  { label: "Weekdays at 08:00", cron: "0 8 * * 1-5", hint: "Before the workday" },
  { label: "Weekdays at 18:30", cron: "30 18 * * 1-5", hint: "After hours" },
  { label: "Weekly, Sunday 03:00", cron: "0 3 * * 0", hint: "Patch window" },
  { label: "Monthly, 1st at 04:00", cron: "0 4 1 * *", hint: "Monthly reports" },
  { label: "Patch Tuesday +3 days, 22:00", cron: "0 22 10-16 * 5", hint: "Friday after Patch Tuesday" },
];

/** Common IANA zones for the picker (the editor also accepts any valid zone). */
export const COMMON_TIMEZONES = [
  "UTC", "Europe/London", "Europe/Dublin", "Europe/Paris", "Europe/Berlin", "Europe/Amsterdam", "Europe/Madrid", "Europe/Rome", "Europe/Stockholm", "Europe/Warsaw", "Europe/Athens", "Europe/Istanbul", "Europe/Moscow",
  "America/New_York", "America/Chicago", "America/Denver", "America/Phoenix", "America/Los_Angeles", "America/Anchorage", "America/Toronto", "America/Vancouver", "America/Mexico_City", "America/Sao_Paulo", "America/Bogota", "America/Argentina/Buenos_Aires",
  "Asia/Dubai", "Asia/Kolkata", "Asia/Singapore", "Asia/Hong_Kong", "Asia/Shanghai", "Asia/Tokyo", "Asia/Seoul", "Asia/Jakarta", "Asia/Bangkok", "Asia/Karachi", "Asia/Riyadh", "Asia/Jerusalem",
  "Africa/Johannesburg", "Africa/Cairo", "Africa/Lagos", "Africa/Nairobi",
  "Australia/Sydney", "Australia/Melbourne", "Australia/Perth", "Australia/Brisbane", "Pacific/Auckland", "Pacific/Honolulu",
];
