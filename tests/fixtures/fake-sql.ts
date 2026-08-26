import type { SqlExecutor } from "@/lib/data/postgres-repository";
import type { BenchmarkObservation } from "@/types/benchmark";

/**
 * An in-memory stand-in for PostgreSQL.
 *
 * It does not parse SQL. It recognises the handful of statements the benchmark
 * repository issues and applies the same *semantics* — including the
 * `(series_code, observation_date)` upsert — so the repository's behaviour can
 * be tested without a database.
 *
 * That is a real limit and worth stating: this proves the repository's logic and
 * the ingest service's contract, not that the SQL is syntactically valid. Only a
 * live database proves the latter.
 */
export interface FakeDb {
  executeSql: SqlExecutor;
  rows: Map<string, BenchmarkObservation>;
  runs: Array<Record<string, unknown>>;
  queries: string[];
  /** Force the next call to reject, for error-path tests. */
  failNext: (message: string) => void;
}

export function createFakeDb(): FakeDb {
  const rows = new Map<string, BenchmarkObservation>();
  const runs: Array<Record<string, unknown>> = [];
  const queries: string[] = [];
  let pendingFailure: string | null = null;
  let runSequence = 0;

  const executeSql: SqlExecutor = async <TRow = Record<string, unknown>>(
    sql: string,
    params: unknown[] = [],
  ): Promise<TRow[]> => {
    queries.push(sql.trim().split("\n")[0]);

    if (pendingFailure) {
      const message = pendingFailure;
      pendingFailure = null;
      throw new Error(message);
    }

    if (sql.includes("INSERT INTO market_benchmarks")) {
      const [codes, dates, values, sources, retrieved, qualities] = params as [
        string[], string[], number[], string[], string[], string[],
      ];
      const written: TRow[] = [];
      codes.forEach((code, i) => {
        rows.set(`${code}:${dates[i]}`, {
          seriesCode: code as BenchmarkObservation["seriesCode"],
          observationDate: dates[i],
          value: values[i],
          source: sources[i],
          retrievedAt: retrieved[i],
          dataQuality: qualities[i] as BenchmarkObservation["dataQuality"],
        });
        written.push({ written: 1 } as TRow);
      });
      return written;
    }

    if (sql.includes("FROM market_benchmarks")) {
      const seriesCode = params[0] as string;
      let all = [...rows.values()]
        .filter((row) => row.seriesCode === seriesCode)
        .sort((a, b) => a.observationDate.localeCompare(b.observationDate));

      if (sql.includes("observation_date < $2")) {
        const before = params[1] as string;
        const previous = all.filter((row) => row.observationDate < before).pop();
        return (previous ? [toRow(previous)] : []) as TRow[];
      }

      if (sql.includes("ORDER BY observation_date DESC\n        LIMIT 1")) {
        const latest = all[all.length - 1];
        return (latest ? [toRow(latest)] : []) as TRow[];
      }

      const [, startDate, endDate, limit] = params as [string, string | null, string | null, number | null];
      if (startDate) all = all.filter((row) => row.observationDate >= startDate);
      if (endDate) all = all.filter((row) => row.observationDate <= endDate);
      if (limit && all.length > limit) all = all.slice(all.length - limit);
      return all.map(toRow) as TRow[];
    }

    if (sql.includes("INSERT INTO import_runs")) {
      runSequence += 1;
      runs.unshift({
        id: String(runSequence),
        data_source_id: params[0],
        status: "running",
        triggered_by: params[1],
        started_at: new Date().toISOString(),
        completed_at: null,
        records_imported: 0,
        error_message: null,
        error_kind: null,
      });
      return [{ id: String(runSequence) }] as TRow[];
    }

    if (sql.includes("UPDATE import_runs")) {
      const run = runs.find((entry) => entry.id === params[0]);
      if (run) {
        run.status = params[1];
        run.records_imported = params[2];
        run.records_received = params[3];
        run.records_rejected = params[4];
        run.error_message = params[5];
        run.error_kind = params[6];
        run.completed_at = new Date().toISOString();
      }
      return [] as TRow[];
    }

    if (sql.includes("FROM import_runs")) {
      const sourceId = params[0] as string | null;
      return runs.filter((run) => !sourceId || run.data_source_id === sourceId) as TRow[];
    }

    return [] as TRow[];
  };

  return {
    executeSql,
    rows,
    runs,
    queries,
    failNext: (message: string) => {
      pendingFailure = message;
    },
  };
}

function toRow(observation: BenchmarkObservation): Record<string, unknown> {
  return {
    series_code: observation.seriesCode,
    observation_date: observation.observationDate,
    value: observation.value,
    source: observation.source,
    retrieved_at: observation.retrievedAt,
    data_quality: observation.dataQuality,
  };
}
