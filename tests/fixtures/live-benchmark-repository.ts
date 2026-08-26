import type {
  BenchmarkHistoryQuery,
  MarketBenchmarkRepository,
} from "@/lib/data/benchmark-repository";
import type { BenchmarkObservation, BenchmarkSeriesCode } from "@/types/benchmark";

/**
 * An in-memory repository that reports itself as `live`.
 *
 * The demo repository is permanently `demo`, which the health engine correctly
 * short-circuits to the `demo` state — so it cannot be used to exercise
 * healthy, stale or failing. This one stands in for a connected database.
 */
export class FakeLiveBenchmarkRepository implements MarketBenchmarkRepository {
  readonly name = "Fake live store (test)";
  readonly dataQuality = "live" as const;

  constructor(private observations: BenchmarkObservation[] = []) {}

  private forSeries(seriesCode: BenchmarkSeriesCode) {
    return this.observations
      .filter((row) => row.seriesCode === seriesCode)
      .sort((a, b) => a.observationDate.localeCompare(b.observationDate));
  }

  async getLatest(seriesCode: BenchmarkSeriesCode) {
    const rows = this.forSeries(seriesCode);
    return rows.at(-1) ?? null;
  }

  async getPrevious(seriesCode: BenchmarkSeriesCode, observationDate: string) {
    const rows = this.forSeries(seriesCode).filter(
      (row) => row.observationDate < observationDate,
    );
    return rows.at(-1) ?? null;
  }

  async getHistory(query: BenchmarkHistoryQuery) {
    return this.forSeries(query.seriesCode).filter(
      (row) =>
        (!query.startDate || row.observationDate >= query.startDate) &&
        (!query.endDate || row.observationDate <= query.endDate),
    );
  }

  /** Upserts on `(seriesCode, observationDate)`, matching the real contract. */
  async upsertObservations(observations: BenchmarkObservation[]) {
    for (const incoming of observations) {
      const index = this.observations.findIndex(
        (row) =>
          row.seriesCode === incoming.seriesCode &&
          row.observationDate === incoming.observationDate,
      );
      if (index === -1) this.observations.push(incoming);
      else this.observations[index] = incoming;
    }
    return observations.length;
  }
}

export function liveObservation(
  observationDate: string,
  value = 3.2,
  seriesCode: BenchmarkSeriesCode = "5y-canada-bond",
): BenchmarkObservation {
  return {
    seriesCode,
    observationDate,
    value,
    source: "src-boc-valet",
    retrievedAt: `${observationDate}T21:00:00.000Z`,
    dataQuality: "live",
  };
}
