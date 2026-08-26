/**
 * Canadian business-day arithmetic.
 *
 * The Bank of Canada publishes benchmark yields once per business day. Any
 * freshness rule that counts *calendar* days therefore declares perfectly good
 * data stale every weekend, and again on Good Friday, and again at Christmas.
 * Counting business days instead is the only way "Friday's number, read on
 * Sunday" comes out as current — which it is.
 *
 * Dates here are `YYYY-MM-DD` strings handled in UTC. Using UTC throughout
 * avoids the class of bug where a server in one timezone and a browser in
 * another disagree about which day it is; the observation date is a label on a
 * business day, not an instant.
 */

/** `YYYY-MM-DD` → UTC midnight. Throws on anything that is not a real date. */
export function parseIsoDate(date: string): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) throw new Error(`Invalid date "${date}". Expected YYYY-MM-DD.`);

  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const parsed = new Date(Date.UTC(year, month - 1, day));

  // `Date.UTC` happily rolls 2026-02-31 forward into March. Comparing the parts
  // back is what turns that silent acceptance into a rejection.
  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  ) {
    throw new Error(`Invalid date "${date}". That day does not exist.`);
  }
  return parsed;
}

export function isValidIsoDate(value: string): boolean {
  try {
    parseIsoDate(value);
    return true;
  } catch {
    return false;
  }
}

export function toIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function addDays(date: string, delta: number): string {
  const parsed = parseIsoDate(date);
  parsed.setUTCDate(parsed.getUTCDate() + delta);
  return toIsoDate(parsed);
}

/** Calendar days from `a` to `b`. Positive when `b` is later. */
export function daysBetween(a: string, b: string): number {
  return Math.round(
    (parseIsoDate(b).getTime() - parseIsoDate(a).getTime()) / 86_400_000,
  );
}

/**
 * Easter Sunday for a Gregorian year, by the anonymous Gregorian algorithm.
 *
 * Needed only because Good Friday is two days before it, and Good Friday is the
 * one Canadian market holiday that cannot be written as "the nth Monday of".
 */
function easterSunday(year: number): Date {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(Date.UTC(year, month - 1, day));
}

/** The nth given weekday of a month, e.g. the 3rd Monday of February. */
function nthWeekdayOfMonth(
  year: number,
  month: number,
  weekday: number,
  nth: number,
): Date {
  const first = new Date(Date.UTC(year, month - 1, 1));
  const offset = (weekday - first.getUTCDay() + 7) % 7;
  return new Date(Date.UTC(year, month - 1, 1 + offset + (nth - 1) * 7));
}

/** A statutory holiday falling at a weekend is observed on the Monday. */
function observedOnWeekday(date: Date): Date {
  const day = date.getUTCDay();
  if (day === 6) return new Date(date.getTime() + 2 * 86_400_000);
  if (day === 0) return new Date(date.getTime() + 86_400_000);
  return date;
}

const holidayCache = new Map<number, Set<string>>();

/**
 * Days the Canadian bond market is closed, for one year.
 *
 * This follows the standard Canadian bond-market calendar rather than any single
 * jurisdiction's statutory list. Québec observes National Patriots' Day on the
 * same Monday as Victoria Day, so the two coincide and the set is unchanged.
 *
 * Being slightly wrong here is cheap in both directions: a missed holiday makes
 * the freshness rule marginally stricter for one day, and an extra one makes it
 * marginally looser. Neither corrupts data.
 */
export function marketHolidays(year: number): Set<string> {
  const cached = holidayCache.get(year);
  if (cached) return cached;

  const easter = easterSunday(year);
  const goodFriday = new Date(easter.getTime() - 2 * 86_400_000);

  const dates = [
    observedOnWeekday(new Date(Date.UTC(year, 0, 1))), // New Year's Day
    nthWeekdayOfMonth(year, 2, 1, 3), // Family Day — 3rd Monday of February
    goodFriday,
    // Victoria Day / National Patriots' Day — Monday before 25 May.
    (() => {
      const may25 = new Date(Date.UTC(year, 4, 25));
      const back = (may25.getUTCDay() + 6) % 7 || 7;
      return new Date(may25.getTime() - back * 86_400_000);
    })(),
    observedOnWeekday(new Date(Date.UTC(year, 6, 1))), // Canada Day
    nthWeekdayOfMonth(year, 8, 1, 1), // Civic Holiday — 1st Monday of August
    nthWeekdayOfMonth(year, 9, 1, 1), // Labour Day
    nthWeekdayOfMonth(year, 9, 30, 1), // placeholder replaced below
    nthWeekdayOfMonth(year, 10, 1, 2), // Thanksgiving — 2nd Monday of October
    observedOnWeekday(new Date(Date.UTC(year, 10, 11))), // Remembrance Day
    observedOnWeekday(new Date(Date.UTC(year, 11, 25))), // Christmas Day
    observedOnWeekday(new Date(Date.UTC(year, 11, 26))), // Boxing Day
  ];

  const set = new Set(dates.map(toIsoDate));
  // The National Day for Truth and Reconciliation, 30 September, is a federal
  // holiday; markets observe it inconsistently, so it is included and the
  // placeholder above is discarded.
  set.delete(toIsoDate(nthWeekdayOfMonth(year, 9, 30, 1)));
  set.add(toIsoDate(observedOnWeekday(new Date(Date.UTC(year, 8, 30)))));

  holidayCache.set(year, set);
  return set;
}

export function isWeekend(date: string): boolean {
  const day = parseIsoDate(date).getUTCDay();
  return day === 0 || day === 6;
}

export function isMarketHoliday(date: string): boolean {
  return marketHolidays(parseIsoDate(date).getUTCFullYear()).has(date);
}

/** A day the Bank of Canada would publish an observation. */
export function isBusinessDay(date: string): boolean {
  return !isWeekend(date) && !isMarketHoliday(date);
}

/** The most recent business day on or before `date`. */
export function previousBusinessDay(date: string): string {
  let cursor = date;
  for (let i = 0; i < 30; i += 1) {
    if (isBusinessDay(cursor)) return cursor;
    cursor = addDays(cursor, -1);
  }
  return cursor;
}

/**
 * Business days from `from` to `to`, counting `to` but not `from`.
 *
 * Friday → Saturday is 0. Friday → Monday is 1. That is what makes a Friday
 * observation read as current all weekend.
 */
export function businessDaysBetween(from: string, to: string): number {
  const total = daysBetween(from, to);
  if (total <= 0) return 0;

  let count = 0;
  let cursor = from;
  for (let i = 0; i < total; i += 1) {
    cursor = addDays(cursor, 1);
    if (isBusinessDay(cursor)) count += 1;
  }
  return count;
}

/** Every business day in `[start, end]`, ascending. */
export function businessDaysInRange(start: string, end: string): string[] {
  const days: string[] = [];
  let cursor = start;
  const total = daysBetween(start, end);
  if (total < 0) return days;

  for (let i = 0; i <= total; i += 1) {
    if (isBusinessDay(cursor)) days.push(cursor);
    cursor = addDays(cursor, 1);
  }
  return days;
}

const MONTH_ABBREVIATIONS = [
  "Jan.", "Feb.", "Mar.", "Apr.", "May", "Jun.",
  "Jul.", "Aug.", "Sep.", "Oct.", "Nov.", "Dec.",
];

/**
 * `Aug. 26, 2026` — a full date for tooltips and tables.
 *
 * Spelling the month out avoids the `08/09` ambiguity between Canadian, American
 * and European readings, and it matches the abbreviation style the monthly
 * labels already use elsewhere in the interface. Formatted by hand rather than
 * through `Intl` so server and client produce byte-identical output; an ICU
 * difference of one character is a hydration mismatch.
 */
export function formatObservationDate(date: string): string {
  const parsed = parseIsoDate(date);
  return `${MONTH_ABBREVIATIONS[parsed.getUTCMonth()]} ${parsed.getUTCDate()}, ${parsed.getUTCFullYear()}`;
}

/** `Aug. 26` — a compact axis tick for short ranges. */
export function formatObservationDateShort(date: string): string {
  const parsed = parseIsoDate(date);
  return `${MONTH_ABBREVIATIONS[parsed.getUTCMonth()]} ${parsed.getUTCDate()}`;
}

/** `Aug. 2026` — a month-level axis tick for long ranges. */
export function formatObservationMonth(date: string): string {
  const parsed = parseIsoDate(date);
  return `${MONTH_ABBREVIATIONS[parsed.getUTCMonth()]} ${parsed.getUTCFullYear()}`;
}
