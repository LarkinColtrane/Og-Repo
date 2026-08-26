import { z } from "zod";
import type { BenchmarkObservation } from "@/types/benchmark";
import { BENCHMARK_SERIES_CODES } from "@/types/benchmark";
import { isValidIsoDate } from "@/lib/calculations/business-days";

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
