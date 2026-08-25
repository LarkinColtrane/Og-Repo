import type { Period, TrendRange } from "@/types";
import { TREND_RANGE_MONTHS } from "@/types";

/**
 * Period arithmetic. A period is the string `YYYY-MM` — deliberately not a `Date`,
 * because a month is a reporting bucket, not an instant, and treating it as one
 * avoids a whole class of timezone bugs when the server and browser disagree.
 */

const PERIOD_PATTERN = /^(\d{4})-(0[1-9]|1[0-2])$/;

export function isValidPeriod(value: string): value is Period {
  return PERIOD_PATTERN.test(value);
}

export function parsePeriod(period: Period): { year: number; month: number } {
  const match = PERIOD_PATTERN.exec(period);
  if (!match) {
    throw new Error(`Invalid period "${period}". Expected YYYY-MM.`);
  }
  return { year: Number(match[1]), month: Number(match[2]) };
}

export function toPeriod(year: number, month: number): Period {
  return `${year}-${String(month).padStart(2, "0")}`;
}

/** Shift a period by a number of months. Negative values move backwards. */
export function addMonths(period: Period, delta: number): Period {
  const { year, month } = parsePeriod(period);
  const zeroBased = year * 12 + (month - 1) + delta;
  return toPeriod(Math.floor(zeroBased / 12), (zeroBased % 12) + 1);
}

/** Whole months between two periods. Positive when `b` is later than `a`. */
export function monthsBetween(a: Period, b: Period): number {
  const start = parsePeriod(a);
  const end = parsePeriod(b);
  return (end.year - start.year) * 12 + (end.month - start.month);
}

export function comparePeriods(a: Period, b: Period): number {
  return a.localeCompare(b);
}

/** `count` consecutive periods ending at `latest`, in ascending order. */
export function periodSeries(latest: Period, count: number): Period[] {
  return Array.from({ length: count }, (_, i) => addMonths(latest, -(count - 1 - i)));
}

/** The earliest period a trend range covers, relative to `latest`. */
export function rangeStart(latest: Period, range: TrendRange): Period {
  return addMonths(latest, -(TREND_RANGE_MONTHS[range] - 1));
}

const MONTH_LABELS_EN = [
  "Jan.",
  "Feb.",
  "Mar.",
  "Apr.",
  "May",
  "Jun.",
  "Jul.",
  "Aug.",
  "Sep.",
  "Oct.",
  "Nov.",
  "Dec.",
];

const MONTH_LABELS_FR = [
  "janv.",
  "févr.",
  "mars",
  "avr.",
  "mai",
  "juin",
  "juill.",
  "août",
  "sept.",
  "oct.",
  "nov.",
  "déc.",
];

/**
 * Format a period for display: `Jun. 2026`, or `Jun.` when the year is implied by
 * neighbouring ticks.
 */
export function formatPeriod(
  period: Period,
  options: { locale?: "en" | "fr"; withYear?: boolean } = {},
): string {
  const { locale = "en", withYear = true } = options;
  const { year, month } = parsePeriod(period);
  const label = (locale === "fr" ? MONTH_LABELS_FR : MONTH_LABELS_EN)[month - 1];
  return withYear ? `${label} ${year}` : label;
}

/** Format an ISO timestamp as a month-and-year label, for "Updated …" lines. */
export function formatUpdatedAt(iso: string | null, locale: "en" | "fr" = "en"): string {
  if (!iso) return locale === "fr" ? "jamais importé" : "never imported";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return formatPeriod(
    toPeriod(date.getUTCFullYear(), date.getUTCMonth() + 1),
    { locale },
  );
}
