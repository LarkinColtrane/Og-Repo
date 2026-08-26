import { z } from "zod";
import type { BenchmarkObservation } from "@/types/benchmark";
import { BENCHMARK_SERIES_CODES } from "@/types/benchmark";
import { isValidIsoDate } from "@/lib/calculations/business-days";
import type { BoroughPermitStat } from "@/types/civic";
import { PERMIT_CATEGORIES } from "@/types/civic";
import { getMunicipality } from "@/lib/geo/montreal";
import { isValidPeriod } from "@/lib/periods";

/**
 * The validation gate.
 *
 * Everything between the publisher and the database passes through here. The
 * bounds are set to reject **corrupted** data without rejecting **unusual**
 * data, which is a harder line than it sounds: a validator tuned to today's
 * market would have thrown away the 1981 bond market, and one tuned to nothing
 * would happily store a unit error.
 *
 * The failures actually worth catching:
 *
 *  - `Number("")` → `0`. A 0% yield is arithmetically fine and completely wrong.
 *  - A feed switching percent to fraction sends `0.0321` for 3.21%.
 *  - A parse slip sends `321` for 3.21%.
 *  - A malformed or impossible date.
 *  - The same observation date twice, which would make an upsert ambiguous.
 */

/**
 * Plausible bounds for a Canadian benchmark yield, in percent.
 *
 * The lower bound is negative on purpose: Canadian yields have not gone below
 * zero, but German and Japanese ones have, and a validator that treats a
 * negative yield as impossible is asserting something about markets that is not
 * true. −5 to 30 covers every rate Canada has published since the series began,
 * with room on both sides, while still catching a fraction (0.0321 → rejected
 * as implausibly low is *not* what happens — see the note below).
 */
export const YIELD_BOUNDS = { min: -5, max: 30 } as const;

/**
 * The narrower band a value must clear to avoid being *flagged*.
 *
 * A fraction-instead-of-percent error produces 0.0321, which is inside the hard
 * bounds and cannot be rejected outright — a genuine near-zero policy rate looks
 * the same. So it is caught statistically instead: `detectUnitAnomaly` compares
 * a batch against this band and fails the run when the whole batch sits below
 * it, which a real market never does for long.
 */
export const PLAUSIBLE_YIELD_BAND = { min: 0.05, max: 25 } as const;

export const benchmarkObservationSchema = z.object({
  seriesCode: z.enum(BENCHMARK_SERIES_CODES as unknown as [string, ...string[]]),
  observationDate: z
    .string()
    .refine(isValidIsoDate, "Expected a real calendar date in YYYY-MM-DD form."),
  value: z
    .number()
    .refine(Number.isFinite, "Value must be a finite number — NaN and Infinity are not values.")
    .min(YIELD_BOUNDS.min, `Yield below ${YIELD_BOUNDS.min}% is not a real rate.`)
    .max(YIELD_BOUNDS.max, `Yield above ${YIELD_BOUNDS.max}% is not a real rate.`),
  source: z.string().min(1),
  retrievedAt: z.string().min(1),
  dataQuality: z.enum(["live", "demo"]),
});

export type ValidationIssue = {
  /** Index in the input batch, so a rejected row can be found. */
  index: number;
  observationDate: string | null;
  message: string;
};

export interface ValidationResult {
  valid: BenchmarkObservation[];
  rejected: ValidationIssue[];
}

/**
 * Validate a normalized batch.
 *
 * Returns both halves rather than throwing: the ingest service decides what a
 * partial batch means, and it needs the rejected rows to explain the decision.
 */
export function validateBenchmarkObservations(
  observations: unknown[],
): ValidationResult {
  const valid: BenchmarkObservation[] = [];
  const rejected: ValidationIssue[] = [];
  const seenDates = new Set<string>();

  observations.forEach((candidate, index) => {
    const parsed = benchmarkObservationSchema.safeParse(candidate);

    if (!parsed.success) {
      rejected.push({
        index,
        observationDate: readDate(candidate),
        message: parsed.error.issues
          .map((issue) =>
            issue.path.length ? `${issue.path.join(".")}: ${issue.message}` : issue.message,
          )
          .join(" "),
      });
      return;
    }

    // A duplicate date makes the upsert ambiguous — two different values would
    // both claim the same natural key and the winner would be whichever landed
    // last. Rejecting is the only answer that is not arbitrary.
    const key = `${parsed.data.seriesCode}:${parsed.data.observationDate}`;
    if (seenDates.has(key)) {
      rejected.push({
        index,
        observationDate: parsed.data.observationDate,
        message: `Duplicate observation for ${parsed.data.observationDate} in the same batch.`,
      });
      return;
    }
    seenDates.add(key);

    valid.push(parsed.data as BenchmarkObservation);
  });

  return { valid, rejected };
}

/**
 * Catch a whole-batch unit error.
 *
 * One observation of 0.032 is a policy rate near zero. Two hundred consecutive
 * ones, when the series is a bond yield, is a feed that switched to fractions.
 * The distinction is only visible across the batch, which is why this is
 * separate from per-row validation.
 *
 * Returns a message when the batch looks wrong, or null when it does not.
 */
export function detectUnitAnomaly(
  observations: BenchmarkObservation[],
  /** Below this many rows the signal is too weak to act on. */
  minimumSample = 20,
): string | null {
  if (observations.length < minimumSample) return null;

  const values = observations.map((observation) => observation.value);
  const belowBand = values.filter((value) => value < PLAUSIBLE_YIELD_BAND.min).length;
  const aboveBand = values.filter((value) => value > PLAUSIBLE_YIELD_BAND.max).length;

  if (belowBand === values.length) {
    const max = Math.max(...values);
    return `Every one of ${values.length} observations is below ${PLAUSIBLE_YIELD_BAND.min}% (highest ${max}). This is the shape of a feed reporting fractions instead of percent; refusing rather than storing it.`;
  }

  if (aboveBand === values.length) {
    const min = Math.min(...values);
    return `Every one of ${values.length} observations is above ${PLAUSIBLE_YIELD_BAND.max}% (lowest ${min}). This is the shape of a scale error; refusing rather than storing it.`;
  }

  return null;
}

function readDate(candidate: unknown): string | null {
  if (typeof candidate === "object" && candidate !== null && "observationDate" in candidate) {
    const value = (candidate as { observationDate: unknown }).observationDate;
    return typeof value === "string" ? value : null;
  }
  return null;
}

/* ── Civic statistics: Montréal construction permits ──────────────────────── */

/**
 * Bounds for a borough-month of permit activity.
 *
 * Set to reject **corrupted** data without rejecting **unusual** data, the same
 * line the yield bounds walk. Montréal's busiest boroughs issue a few hundred
 * permits a month; 20 000 is far beyond any plausible month and can only mean a
 * grouping bug or a date column that put a decade into one bucket.
 *
 * The declared-value ceiling is deliberately generous. A single large
 * institutional project can declare hundreds of millions, so the bound is there
 * to catch a units error (cents reported as dollars), not to second-guess a
 * real number.
 */
export const PERMIT_BOUNDS = {
  maxPermitsPerBoroughMonth: 20_000,
  maxDwellingUnitsPerBoroughMonth: 50_000,
  maxDeclaredValuePerBoroughMonth: 10_000_000_000,
} as const;

export const permitStatSchema = z.object({
  boroughCode: z
    .string()
    .min(1)
    .refine(
      (code) => getMunicipality(code) !== null,
      "Borough code is not in the Montréal municipality registry.",
    ),
  period: z.string().refine(isValidPeriod, "Expected a reporting period in YYYY-MM form."),
  permitsIssued: z
    .number()
    .int("Permit counts are whole numbers.")
    .min(0, "A permit count cannot be negative.")
    .max(
      PERMIT_BOUNDS.maxPermitsPerBoroughMonth,
      `More than ${PERMIT_BOUNDS.maxPermitsPerBoroughMonth} permits in one borough-month is not a real figure.`,
    ),
  dwellingUnitsCreated: z
    .number()
    .int()
    .min(0)
    .max(PERMIT_BOUNDS.maxDwellingUnitsPerBoroughMonth)
    .nullable(),
  declaredWorkValue: z
    .number()
    .min(0)
    .max(PERMIT_BOUNDS.maxDeclaredValuePerBoroughMonth)
    .nullable(),
  byCategory: z.record(z.string(), z.number().int().min(0)),
  dataSourceId: z.string().min(1),
  retrievedAt: z.string().min(1),
  dataQuality: z.enum(["live", "demo"]),
});

/**
 * Validate a batch of borough-month statistics.
 *
 * Returns both halves rather than throwing, matching
 * `validateBenchmarkObservations`: the ingest service decides what a partial
 * batch means and needs the rejected rows to explain the decision.
 *
 * Two checks the schema cannot express live here:
 *
 *  - **The category counts must sum to the permit total.** They are produced by
 *    the same loop, so a mismatch means the aggregation is wrong — and a
 *    breakdown that does not add up is worse than no breakdown, because it
 *    looks authoritative.
 *  - **`(borough, period)` must be unique.** It is the upsert key. Two rows for
 *    one key make the write order decide the stored value, which is a silent,
 *    non-deterministic bug.
 */
export function validatePermitStats(stats: unknown[]): {
  valid: BoroughPermitStat[];
  rejected: ValidationIssue[];
} {
  const valid: BoroughPermitStat[] = [];
  const rejected: ValidationIssue[] = [];
  const seen = new Set<string>();

  stats.forEach((candidate, index) => {
    const parsed = permitStatSchema.safeParse(candidate);
    if (!parsed.success) {
      rejected.push({
        index,
        observationDate: readPeriod(candidate),
        message: parsed.error.issues
          .map((issue) => `${issue.path.join(".") || "value"}: ${issue.message}`)
          .join("; "),
      });
      return;
    }

    const stat = parsed.data as BoroughPermitStat;

    const categoryTotal = PERMIT_CATEGORIES.reduce(
      (sum, category) => sum + (stat.byCategory[category] ?? 0),
      0,
    );
    if (categoryTotal !== stat.permitsIssued) {
      rejected.push({
        index,
        observationDate: stat.period,
        message: `Category counts total ${categoryTotal} but the row reports ${stat.permitsIssued} permits. A breakdown that does not add up is not published.`,
      });
      return;
    }

    const key = `${stat.boroughCode}|${stat.period}`;
    if (seen.has(key)) {
      rejected.push({
        index,
        observationDate: stat.period,
        message: `Duplicate row for ${stat.boroughCode} in ${stat.period}. (borough, period) is the upsert key and must be unique within a batch.`,
      });
      return;
    }
    seen.add(key);

    valid.push(stat);
  });

  return { valid, rejected };
}

function readPeriod(candidate: unknown): string | null {
  if (typeof candidate === "object" && candidate !== null && "period" in candidate) {
    const period = (candidate as { period: unknown }).period;
    return typeof period === "string" ? period : null;
  }
  return null;
}

/**
 * Batch-level sanity check, run after per-row validation.
 *
 * Catches faults that are invisible one row at a time. Returns a message when
 * the batch should be refused wholesale, `null` when it is fine.
 *
 * **A period in the future is the one that matters.** Permits are issued, then
 * published; a batch containing next year cannot be a real extract. It is also
 * the signature of a misread date column — a `DD/MM` feed parsed as `MM/DD`
 * turns 25 December into an impossible month, and a year column read from the
 * wrong position lands in 2031. Refusing the whole batch is right here: the
 * fault is in the parse, so the rows that happen to look sane are not
 * trustworthy either.
 */
export function detectPermitBatchAnomaly(
  stats: BoroughPermitStat[],
  options: { today?: string } = {},
): string | null {
  if (stats.length === 0) return null;

  const today = options.today ?? new Date().toISOString().slice(0, 7);
  // One month of slack: a permit issued on the 30th can be published in an
  // extract dated the following month without anything being wrong.
  const horizon = addMonthsToPeriod(today, 1);

  const future = stats.filter((stat) => stat.period > horizon);
  if (future.length > 0) {
    const sample = [...new Set(future.map((stat) => stat.period))].sort().slice(0, 5);
    return `${future.length} of ${stats.length} rows report periods after ${horizon} (e.g. ${sample.join(", ")}). Permits cannot be issued in the future, so the date column is being misread. Nothing was written.`;
  }

  const total = stats.reduce((sum, stat) => sum + stat.permitsIssued, 0);
  if (total === 0) {
    return `The batch contains ${stats.length} borough-month rows but zero permits in total. That is an empty extract, not a month with no construction.`;
  }

  return null;
}

/** Local period arithmetic, kept here so validate.ts imports no clock. */
function addMonthsToPeriod(period: string, delta: number): string {
  const [year, month] = period.split("-").map(Number);
  const zeroBased = year * 12 + (month - 1) + delta;
  return `${Math.floor(zeroBased / 12)}-${String((zeroBased % 12) + 1).padStart(2, "0")}`;
}
