import type { BoroughPermitStat, CityPermitSummary, PermitCategory } from "@/types/civic";
import { PERMIT_CATEGORIES } from "@/types/civic";
import type { Period } from "@/types";
import type { BoroughCode } from "@/lib/geo/montreal";

/**
 * The civic-data access contract.
 *
 * A **fourth** repository, alongside market statistics, mortgage rates and
 * market benchmarks:
 *
 *   MarketDataRepository       neighbourhood statistics   monthly         public agencies
 *   MortgageRateRepository     lender pricing             daily           commercial terms
 *   MarketBenchmarkRepository  published market rates     business-daily  open APIs
 *   CivicDataRepository        municipal building data    monthly         municipal open data
 *
 * A fourth interface rather than an extra method on the market one, for the
 * reason the other three are separate: different publisher, different licence,
 * different refresh cadence, and it becomes live on its own day. That
 * independence is what lets the platform serve a real permit count beside a
 * generated median price and label each correctly — the two carry their own
 * `dataQuality`, so neither can drag the other's label with it.
 *
 * Like the benchmark repository and unlike the read-only two, this one
 * **writes**, because civic data is ingested rather than authored. The write
 * path is reachable only from the ingest service.
 */
export interface CivicDataRepository {
  /** Human-readable name for the backing store, shown in diagnostics. */
  readonly name: string;

  /** `demo` while the generated fallback backs it; `live` once a database does. */
  readonly dataQuality: "demo" | "live";

  /** Borough-month statistics, ascending by period. */
  getPermitStats(query: PermitStatQuery): Promise<BoroughPermitStat[]>;

  /** The most recent period on record, or null when there is none. */
  getLatestPeriod(): Promise<Period | null>;

  /** Every borough with at least one statistic on record. */
  getReportingBoroughs(): Promise<BoroughCode[]>;

  /**
   * Insert or update by `(boroughCode, period)`.
   *
   * Idempotent by contract: running the same month twice must leave the same
   * rows, not double them. Returns the number written.
   *
   * **Never deletes.** A re-import that returns fewer boroughs than last time
   * leaves the missing ones as they were, because "the extract did not mention
   * Verdun" is not evidence that Verdun issued no permits. Removing history on
   * the strength of an absence is how one bad import erases a year of good
   * data — see `docs/REAL_DATA_PIPELINE.md`.
   */
  upsertPermitStats(stats: BoroughPermitStat[]): Promise<number>;
}

export interface PermitStatQuery {
  /** Restrict to one borough. Omit for every borough. */
  boroughCode?: BoroughCode;
  /** Inclusive `YYYY-MM` lower bound. */
  from?: Period;
  /** Inclusive `YYYY-MM` upper bound. */
  to?: Period;
  /** Cap, applied to the most recent periods when set. */
  limit?: number;
}

/** Thrown when a store cannot accept writes — the demo fallback, for instance. */
export class CivicWriteNotSupportedError extends Error {
  constructor(storeName: string) {
    super(
      `${storeName} is read-only. Importing civic data requires a database — set DATABASE_URL and apply docs/sql/004_civic_permits.sql.`,
    );
    this.name = "CivicWriteNotSupportedError";
  }
}

/**
 * Roll borough-month rows up to city-month totals.
 *
 * A pure function rather than a repository method so both implementations get
 * it for free and it can be tested without a store. The nullable fields are the
 * interesting part: a city total for dwelling units is `null` unless at least
 * one borough reported a count, because summing `null` as zero would publish a
 * confident under-count.
 */
export function summarisePermitsByPeriod(
  stats: BoroughPermitStat[],
): CityPermitSummary[] {
  const byPeriod = new Map<Period, CityPermitSummary & { sawUnits: boolean; sawValue: boolean }>();

  for (const stat of stats) {
    let summary = byPeriod.get(stat.period);
    if (!summary) {
      const byCategory = {} as Record<PermitCategory, number>;
      for (const category of PERMIT_CATEGORIES) byCategory[category] = 0;
      summary = {
        period: stat.period,
        permitsIssued: 0,
        dwellingUnitsCreated: null,
        declaredWorkValue: null,
        byCategory,
        boroughsReporting: 0,
        // A city total is only as live as its least reliable input. One demo
        // borough in the sum makes the sum demo.
        dataQuality: "live",
        sawUnits: false,
        sawValue: false,
      };
      byPeriod.set(stat.period, summary);
    }

    summary.permitsIssued += stat.permitsIssued;
    summary.boroughsReporting += 1;
    if (stat.dataQuality === "demo") summary.dataQuality = "demo";

    for (const category of PERMIT_CATEGORIES) {
      summary.byCategory[category] += stat.byCategory[category] ?? 0;
    }

    if (stat.dwellingUnitsCreated !== null) {
      summary.dwellingUnitsCreated = (summary.dwellingUnitsCreated ?? 0) + stat.dwellingUnitsCreated;
      summary.sawUnits = true;
    }
    if (stat.declaredWorkValue !== null) {
      summary.declaredWorkValue = (summary.declaredWorkValue ?? 0) + stat.declaredWorkValue;
      summary.sawValue = true;
    }
  }

  return [...byPeriod.values()]
    .sort((a, b) => a.period.localeCompare(b.period))
    .map(({ sawUnits, sawValue, ...summary }) => {
      void sawUnits;
      void sawValue;
      return summary;
    });
}
