import type { BenchmarkObservation, BenchmarkSeriesCode } from "@/types/benchmark";
import {
  addDays,
  businessDaysInRange,
  previousBusinessDay,
  toIsoDate,
} from "@/lib/calculations/business-days";

/**
 * ⚠️ DEMONSTRATION BENCHMARK DATA — NOT BANK OF CANADA FIGURES ⚠️
 *
 * A generated stand-in for the Government of Canada 5-year bond yield, used when
 * no database is connected so the chart and the spread analysis have something
 * to render locally.
 *
 * Two decisions here are about honesty rather than convenience:
 *
 *  1. **The source id is `src-demo-benchmarks`, not `src-boc-valet`.** Attaching
 *     the Bank of Canada's name to numbers this file invented is precisely the
 *     fabrication the whole provenance system exists to prevent. Generated data
 *     gets a generated source.
 *  2. **`dataQuality` is `demo`**, so the interface labels it and never reports
 *     it as live. There is no path by which this data appears without that
 *     label — the repository sets it, not a component prop.
 *
 * It is generated rather than committed as JSON so the repository holds a few
 * dozen lines instead of five years of observations, and so the series always
 * runs up to the present business day.
 *
 * Only business days are produced. Weekends and Canadian market holidays are
 * absent, exactly as they are absent from the real series — the chart must never
 * learn to expect a value for a Saturday.
 */

export const DEMO_BENCHMARK_SOURCE_ID = "src-demo-benchmarks";

/** How much history the fallback generates. */
const DEMO_HISTORY_YEARS = 5;

/** Small, fast, seedable PRNG — the same one the other demo generators use. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashString(value: string): number {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/**
 * The level the walk is pulled toward, as a fraction `t` of the window.
 *
 * Shaped like the last five years of Canadian yields — near zero, a sharp rise
 * through the tightening cycle, then a partial retreat — so the chart exercises
 * the ranges with something other than a flat line. It is a shape, not a record
 * of what happened.
 */
function anchorLevel(t: number): number {
  if (t < 0.18) return 1.0 + (t / 0.18) * 0.6;
  if (t < 0.42) return 1.6 + ((t - 0.18) / 0.24) * 2.3;
  if (t < 0.62) return 3.9 + ((t - 0.42) / 0.2) * 0.35;
  return 4.25 - ((t - 0.62) / 0.38) * 1.05;
}

function buildSeries(seriesCode: BenchmarkSeriesCode, offset: number): BenchmarkObservation[] {
  const today = toIsoDate(new Date());
  const end = previousBusinessDay(today);
  const start = addDays(end, -Math.round(DEMO_HISTORY_YEARS * 365.25));

  const days = businessDaysInRange(start, end);
  const random = mulberry32(hashString(`demo-benchmark:${seriesCode}`));
  const retrievedAt = new Date().toISOString();

  const observations: BenchmarkObservation[] = [];
  let level = anchorLevel(0) + offset;

  days.forEach((observationDate, index) => {
    const t = days.length > 1 ? index / (days.length - 1) : 1;
    const anchor = anchorLevel(t) + offset;

    // Mean-reverting random walk: daily noise, pulled gently back toward the
    // anchor so the path wanders without drifting away from the intended shape.
    const shock = (random() - 0.5) * 0.06;
    level += shock + (anchor - level) * 0.04;

    observations.push({
      seriesCode,
      observationDate,
      // Two decimals, which is the precision the Bank of Canada publishes at.
      value: Math.round(Math.max(0.05, level) * 100) / 100,
      source: DEMO_BENCHMARK_SOURCE_ID,
      retrievedAt,
      dataQuality: "demo",
    });
  });

  return observations;
}

const cache = new Map<BenchmarkSeriesCode, BenchmarkObservation[]>();

/** Generated once per process, like the other demo datasets. */
export function getDemoBenchmarkSeries(
  seriesCode: BenchmarkSeriesCode,
): BenchmarkObservation[] {
  const cached = cache.get(seriesCode);
  if (cached) return cached;

  // The 10-year sits above the 5-year and the policy rate below it, so a future
  // curve view is not flat. Offsets only; the shape is shared.
  const offset =
    seriesCode === "10y-canada-bond" ? 0.35 : seriesCode === "boc-policy-rate" ? -0.4 : 0;

  const series = buildSeries(seriesCode, offset);
  cache.set(seriesCode, series);
  return series;
}
