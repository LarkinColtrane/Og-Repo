import type { BenchmarkObservation, BenchmarkSeriesCode } from "@/types/benchmark";

/**
 * The market-benchmark access contract.
 *
 * A **third** repository, alongside `MarketDataRepository` and
 * `MortgageRateRepository`, and deliberately not folded into either:
 *
 *   MarketDataRepository       neighbourhood statistics   monthly   public agencies
 *   MortgageRateRepository     lender pricing             daily     commercial terms
 *   MarketBenchmarkRepository  published market rates     business-daily  open APIs
 *
 * Different publishers, different refresh schedules, different licences, and
 * they will not become live on the same day. One interface per source class
 * means any of them can be switched independently, and each carries its own
 * `dataQuality` flag so the app can honestly report a live bond yield beside
 * demo rents.
 *
 * Unlike the other two this interface also **writes**, because a benchmark is
 * ingested rather than authored. The write path is used only by the ingest
 * service; nothing in the UI can reach it.
 */
export interface MarketBenchmarkRepository {
  /** Human-readable name for the backing store, shown in diagnostics. */
  readonly name: string;

  /** `demo` while the generated fallback backs it; `live` once a database does. */
  readonly dataQuality: "demo" | "live";

  /** The most recent observation on record, or null when there is none. */
  getLatest(seriesCode: BenchmarkSeriesCode): Promise<BenchmarkObservation | null>;

  /**
   * The observation immediately before `observationDate`, for a day-over-day
   * change. Separate from `getHistory` because the caller wants one row and a
   * range query would fetch a year to find it.
   */
  getPrevious(
    seriesCode: BenchmarkSeriesCode,
    observationDate: string,
  ): Promise<BenchmarkObservation | null>;

  /** Observations in `[startDate, endDate]`, ascending. */
  getHistory(query: BenchmarkHistoryQuery): Promise<BenchmarkObservation[]>;

  /**
   * Insert or update by `(seriesCode, observationDate)`.
   *
   * Idempotent by contract: running the same range twice must leave the same
   * rows, not double them. Returns the number written.
   */
  upsertObservations(observations: BenchmarkObservation[]): Promise<number>;
}

export interface BenchmarkHistoryQuery {
  seriesCode: BenchmarkSeriesCode;
  /** Inclusive `YYYY-MM-DD`. */
  startDate?: string;
  /** Inclusive `YYYY-MM-DD`. */
  endDate?: string;
  /** Cap, applied to the most recent rows when set. */
  limit?: number;
}

/** Thrown when a store cannot accept writes — the demo fallback, for instance. */
export class BenchmarkWriteNotSupportedError extends Error {
  constructor(storeName: string) {
    super(
      `${storeName} is read-only. Ingestion requires a database — set DATABASE_URL and apply docs/sql/003_market_benchmarks.sql.`,
    );
    this.name = "BenchmarkWriteNotSupportedError";
  }
}
