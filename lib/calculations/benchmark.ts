import type {
  BenchmarkFreshness,
  BenchmarkObservation,
  BenchmarkRange,
  BenchmarkSeriesMeta,
} from "@/types/benchmark";
import { BENCHMARK_RANGE_DAYS } from "@/types/benchmark";
import { addDays, businessDaysBetween, toIsoDate } from "./business-days";
import type { MortgageRate } from "@/types/mortgage";

/**
 * Freshness, and the mortgage spread.
 *
 * Both are derived on read and neither is stored. A spread computed at import
 * time would be a third number to keep in sync with the two it comes from; a
 * freshness flag written to the database would start lying the moment the clock
 * moved past it.
 */

/**
 * ## The staleness rule
 *
 * An observation is **live** when it is no more than `maxBusinessDayLag`
 * *business days* old, **stale** beyond that.
 *
 * Business days, not calendar days, and that is the whole point. The Bank of
 * Canada publishes once per business day, so:
 *
 *   - Friday's observation read on Saturday → 0 business days old → live.
 *   - Friday's observation read on Monday   → 1 business day old  → live.
 *   - An observation from three weeks ago   → ~15 business days   → stale.
 *
 * A calendar-day rule would declare Friday's number stale every Sunday, and the
 * interface would cry wolf twice a week until nobody read it. Canadian market
 * holidays are excluded from the count too, so Good Friday and Christmas do not
 * age the data either.
 *
 * The default allowance is **2 business days** for the bond series: enough to
 * absorb the publication lag (the Bank posts in the afternoon, so the current
 * day's figure is not available all morning) plus one missed run, without
 * letting a genuinely stalled pipeline look healthy for a week.
 *
 * Demo data is never live or stale — it is `demo`, a separate state, because the
 * question "is this current?" does not apply to a number nobody published.
 */
export function assessBenchmarkFreshness(options: {
  latest: BenchmarkObservation | null;
  series: BenchmarkSeriesMeta;
  /** Injected so the rule is testable without mocking the clock. */
  today?: string;
}): { freshness: BenchmarkFreshness; businessDayLag: number | null } {
  const { latest, series } = options;

  if (!latest) return { freshness: "unavailable", businessDayLag: null };
  if (latest.dataQuality === "demo") return { freshness: "demo", businessDayLag: null };

  const today = options.today ?? toIsoDate(new Date());
  const lag = businessDaysBetween(latest.observationDate, today);

  return {
    freshness: lag <= series.maxBusinessDayLag ? "live" : "stale",
    businessDayLag: lag,
  };
}

/** The inclusive start date for a chart range, relative to `endDate`. */
export function benchmarkRangeStart(range: BenchmarkRange, endDate: string): string {
  return addDays(endDate, -BENCHMARK_RANGE_DAYS[range]);
}

/**
 * ## Mortgage spread
 *
 * `lender fixed rate − Government of Canada bond yield of the same term`.
 *
 * The spread is roughly what a lender charges over its wholesale funding cost —
 * it covers credit risk, operating cost, capital and margin. Watching it move
 * separates "mortgages got more expensive because bond yields rose" from
 * "mortgages got more expensive because lenders widened their margin", which the
 * headline rate alone cannot tell you.
 *
 * **It is only meaningful for fixed-rate products.** Variable mortgages are
 * priced off the lender's prime rate, which follows the Bank of Canada's policy
 * rate — a different instrument at the short end of the curve. Subtracting a
 * 5-year bond yield from a variable rate produces a number with no
 * interpretation, so this returns `null` and the interface shows nothing rather
 * than something meaningless.
 *
 * The term must match too: a 3-year fixed compared against the 5-year bond is
 * two different points on the yield curve.
 */
export interface SpreadInput {
  rate: Pick<MortgageRate, "rate" | "productType" | "termYears">;
  benchmark: BenchmarkObservation | null;
  /** The term the benchmark series represents, in years. */
  benchmarkTermYears: number;
}

export interface SpreadResult {
  /** Percentage points. `1.58` means the lender rate is 158 bps over the bond. */
  spread: number;
  mortgageRate: number;
  benchmarkValue: number;
  benchmarkDate: string;
}

/** Returns null whenever the comparison would not mean anything. */
export function calculateMortgageSpread(input: SpreadInput): SpreadResult | null {
  const { rate, benchmark, benchmarkTermYears } = input;

  if (!benchmark) return null;
  // Variable products track prime, not the bond curve.
  if (rate.productType !== "fixed") return null;
  // Different points on the curve are not comparable.
  if (rate.termYears !== benchmarkTermYears) return null;

  const spread = rate.rate - benchmark.value;

  return {
    spread: Math.round(spread * 100) / 100,
    mortgageRate: rate.rate,
    benchmarkValue: benchmark.value,
    benchmarkDate: benchmark.observationDate,
  };
}

/** Term in years that a benchmark series represents, when it represents one. */
export function benchmarkTermYears(seriesCode: string): number | null {
  if (seriesCode === "5y-canada-bond") return 5;
  if (seriesCode === "10y-canada-bond") return 10;
  // The policy rate is an overnight instrument; it has no term to match against.
  return null;
}
