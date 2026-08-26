/**
 * Market benchmark vocabulary.
 *
 * A *benchmark* is a published market rate that provides context for housing
 * finance without being a consumer offer — the Government of Canada 5-year bond
 * yield is the first one. It is deliberately a third category alongside market
 * statistics and lender rates:
 *
 *   MarketDataRepository      neighbourhood prices and rents   monthly, public agencies
 *   MortgageRateRepository    lender pricing                   daily, commercial terms
 *   MarketBenchmarkRepository published market rates           business-daily, open APIs
 *
 * They meet only in the analysis and UI layers. A bond yield is not a mortgage
 * rate and must never be presented as one — see docs/BANK_OF_CANADA.md.
 */

/**
 * Internal series identifier. Stable, URL-safe, and independent of whatever the
 * upstream publisher calls it — `BD.CDN.5YR.DQ.YLD` is a Bank of Canada
 * implementation detail that should not leak into our URLs or our database.
 */
export type BenchmarkSeriesCode = "5y-canada-bond" | "10y-canada-bond" | "boc-policy-rate";

export const BENCHMARK_SERIES_CODES: readonly BenchmarkSeriesCode[] = [
  "5y-canada-bond",
  "10y-canada-bond",
  "boc-policy-rate",
];

/**
 * One published observation.
 *
 * `observationDate` is the date the value describes (a business day), not the
 * date it was fetched. `retrievedAt` is the latter. Conflating them is how a
 * dataset loses the ability to answer "what did we know, and when?".
 */
export interface BenchmarkObservation {
  seriesCode: BenchmarkSeriesCode;
  /** `YYYY-MM-DD`, the business day the value applies to. */
  observationDate: string;
  /** Percent per annum. `3.21` means 3.21%. */
  value: number;
  /** Data source id, resolvable in the source registry. */
  source: string;
  /** ISO timestamp of when this observation was fetched from upstream. */
  retrievedAt: string;
  /** `live` once a real import writes it; `demo` for the generated fallback. */
  dataQuality: BenchmarkDataQuality;
}

export type BenchmarkDataQuality = "live" | "demo";

/**
 * How much the reader should trust what is on screen.
 *
 * Wider than `dataQuality` because "we imported real data once, four months ago"
 * is neither live nor demo — it is stale, and saying so is the whole point of
 * this type existing.
 */
export type BenchmarkFreshness =
  /** Real data, observed within the expected publication lag. */
  | "live"
  /** Real data, but older than the publication schedule can explain. */
  | "stale"
  /** Generated fallback. Never presented as a market measurement. */
  | "demo"
  /** Nothing on record for this series. */
  | "unavailable";

/** Static description of a series, for labels and documentation. */
export interface BenchmarkSeriesMeta {
  code: BenchmarkSeriesCode;
  label: string;
  shortLabel: string;
  /** One sentence on what the series actually measures. */
  description: string;
  /** The publisher's own identifier, e.g. a Bank of Canada Valet series name. */
  upstreamCode: string;
  /** Data source id in the registry. */
  sourceId: string;
  unit: "percent";
  /** How often the publisher releases a new observation. */
  cadence: "business-daily";
  /**
   * Business days after which an observation stops counting as current.
   * See `assessBenchmarkFreshness` for why this is counted in business days.
   */
  maxBusinessDayLag: number;
}

/** Latest observation plus everything needed to judge how much to trust it. */
export interface BenchmarkSnapshot {
  series: BenchmarkSeriesMeta;
  latest: BenchmarkObservation | null;
  /** Change against the previous observation, in percentage points. */
  changeFromPrevious: number | null;
  freshness: BenchmarkFreshness;
  /** Business days between the latest observation and today. */
  businessDayLag: number | null;
  /** ISO timestamp of the last import run that succeeded for this source. */
  lastSuccessfulImportAt: string | null;
  /** ISO timestamp of the last import run that failed, if more recent. */
  lastFailedImportAt: string | null;
  /** Why the last import failed, when one did. */
  lastFailureMessage: string | null;
}

/** Ranges the benchmark chart offers. Distinct from the monthly TrendRange. */
export type BenchmarkRange = "3m" | "1y" | "3y" | "5y";

export const BENCHMARK_RANGES: readonly BenchmarkRange[] = ["3m", "1y", "3y", "5y"];

/** Approximate calendar days each range covers. */
export const BENCHMARK_RANGE_DAYS: Record<BenchmarkRange, number> = {
  "3m": 92,
  "1y": 365,
  "3y": 1095,
  "5y": 1826,
};

/** The payload `GET /api/market/benchmarks` returns. */
export interface BenchmarkSeriesPayload {
  snapshot: BenchmarkSnapshot;
  observations: BenchmarkObservation[];
  range: BenchmarkRange;
}
