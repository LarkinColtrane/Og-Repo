import type { BenchmarkObservation, BenchmarkSeriesCode } from "@/types/benchmark";
import { getDemoBenchmarkSeries } from "@/data/demo/benchmarks";
import {
  BenchmarkWriteNotSupportedError,
  type BenchmarkHistoryQuery,
  type MarketBenchmarkRepository,
} from "./benchmark-repository";

/**
 * Read-only fallback backed by the generated demo series.
 *
 * It **refuses writes** rather than accepting them into memory. An ingest that
 * appeared to succeed against a store that forgets everything on restart is the
 * worst of both worlds: the run is recorded as a success, the diagnostics look
 * healthy, and the data is gone. Failing loudly points at the real fix, which is
 * connecting a database.
 */
export class DemoMarketBenchmarkRepository implements MarketBenchmarkRepository {
  readonly name = "In-memory demo benchmark series";
  readonly dataQuality = "demo" as const;

  async getLatest(seriesCode: BenchmarkSeriesCode): Promise<BenchmarkObservation | null> {
    const series = getDemoBenchmarkSeries(seriesCode);
    return series.length > 0 ? series[series.length - 1] : null;
  }

  async getPrevious(
    seriesCode: BenchmarkSeriesCode,
    observationDate: string,
  ): Promise<BenchmarkObservation | null> {
    const series = getDemoBenchmarkSeries(seriesCode);
    for (let i = series.length - 1; i >= 0; i -= 1) {
      if (series[i].observationDate < observationDate) return series[i];
    }
    return null;
  }

  async getHistory(query: BenchmarkHistoryQuery): Promise<BenchmarkObservation[]> {
    let rows = getDemoBenchmarkSeries(query.seriesCode).filter((observation) => {
      if (query.startDate && observation.observationDate < query.startDate) return false;
      if (query.endDate && observation.observationDate > query.endDate) return false;
      return true;
    });

    // A limit takes the most recent rows, then restores ascending order — the
    // same semantics the SQL implementation has.
    if (query.limit !== undefined && rows.length > query.limit) {
      rows = rows.slice(rows.length - query.limit);
    }
    return rows;
  }

  async upsertObservations(observations: BenchmarkObservation[]): Promise<number> {
    // The argument is deliberately ignored: this store has nowhere durable to
    // put it, and accepting a write it cannot honour is the failure mode the
    // whole provenance system exists to prevent.
    void observations;
    throw new BenchmarkWriteNotSupportedError(this.name);
  }
}
