import type { BenchmarkSeriesCode, BenchmarkSeriesMeta } from "@/types/benchmark";

/**
 * The registry mapping our internal series codes to Bank of Canada Valet names.
 *
 * Two identifiers on purpose. `5y-canada-bond` is ours: it appears in URLs, in
 * the database and in the UI, and it is stable. `BD.CDN.5YR.DQ.YLD` is theirs,
 * and it is confined to this file plus the connector. If the Bank ever renames a
 * series, one entry changes and nothing else notices.
 *
 * Adding a series is one entry here — the connector, normalizer, validator,
 * ingest service and API are all series-agnostic.
 */
export const BANK_OF_CANADA_SOURCE_ID = "src-boc-valet";

export const BENCHMARK_SERIES: Record<BenchmarkSeriesCode, BenchmarkSeriesMeta> = {
  "5y-canada-bond": {
    code: "5y-canada-bond",
    label: "Government of Canada 5-year benchmark bond yield",
    shortLabel: "5Y GoC bond yield",
    description:
      "The yield on the Government of Canada bond used as the 5-year benchmark. Lenders fund 5-year fixed mortgages against this part of the curve, so it moves before fixed mortgage pricing does — but it is a wholesale funding rate, not an offer to a borrower.",
    upstreamCode: "BD.CDN.5YR.DQ.YLD",
    sourceId: BANK_OF_CANADA_SOURCE_ID,
    unit: "percent",
    cadence: "business-daily",
    // Published each business day, generally in the afternoon Eastern time. Two
    // business days of slack absorbs the publication lag and a missed run
    // without letting a genuinely stalled pipeline look healthy.
    maxBusinessDayLag: 2,
  },
  "10y-canada-bond": {
    code: "10y-canada-bond",
    label: "Government of Canada 10-year benchmark bond yield",
    shortLabel: "10Y GoC bond yield",
    description:
      "The yield on the Government of Canada bond used as the 10-year benchmark. Included as a second point on the curve; not yet surfaced in the interface.",
    upstreamCode: "BD.CDN.10YR.DQ.YLD",
    sourceId: BANK_OF_CANADA_SOURCE_ID,
    unit: "percent",
    cadence: "business-daily",
    maxBusinessDayLag: 2,
  },
  "boc-policy-rate": {
    code: "boc-policy-rate",
    label: "Bank of Canada target for the overnight rate",
    shortLabel: "Policy rate",
    description:
      "The Bank's policy interest rate. Variable mortgage pricing follows this, which is why it — and not the 5-year bond — is the benchmark a variable product should be read against.",
    upstreamCode: "V39079",
    sourceId: BANK_OF_CANADA_SOURCE_ID,
    unit: "percent",
    cadence: "business-daily",
    // Changed only on scheduled announcement dates, so it can legitimately sit
    // unchanged for weeks. The lag allowance is wider for that reason.
    maxBusinessDayLag: 10,
  },
};

export function getBenchmarkSeries(code: BenchmarkSeriesCode): BenchmarkSeriesMeta {
  return BENCHMARK_SERIES[code];
}

/** Resolve an arbitrary string to a known series, or null. */
export function findBenchmarkSeries(code: string): BenchmarkSeriesMeta | null {
  return (BENCHMARK_SERIES as Record<string, BenchmarkSeriesMeta>)[code] ?? null;
}

/** The series the interface currently shows. */
export const PRIMARY_BENCHMARK_SERIES: BenchmarkSeriesCode = "5y-canada-bond";

/**
 * The series a scheduled run imports, and therefore the only ones monitoring
 * will alert on.
 *
 * The other two are registered so the mapping is documented and so adding them
 * is a one-line change — but nothing imports them yet, and a monitor that pages
 * about a pipeline nobody asked to run is a monitor that gets muted. Add a code
 * here and it becomes both scheduled and monitored in the same edit, which is
 * the point: the two lists cannot drift apart because there is only one.
 */
export const SCHEDULED_BENCHMARK_SERIES: readonly BenchmarkSeriesCode[] = [
  "5y-canada-bond",
];
