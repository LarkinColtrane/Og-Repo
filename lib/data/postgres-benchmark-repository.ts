import type { BenchmarkObservation, BenchmarkSeriesCode } from "@/types/benchmark";
import type { ImportRun } from "@/types";
import type {
  BenchmarkHistoryQuery,
  MarketBenchmarkRepository,
} from "./benchmark-repository";
import type { SqlExecutor } from "./postgres-repository";
import {
  summariseHealth,
  type CompleteRunInput,
  type ImportHealth,
  type ImportRunStore,
  type StartRunInput,
} from "./import-run-store";

/**
 * PostgreSQL implementation of the benchmark repository.
 *
 * ── Status ──────────────────────────────────────────────────────────────
 * Written and exercised by unit tests against a fake `SqlExecutor`, but **not
 * connected** — there is no database in this repository and no driver in
 * package.json. Apply `docs/sql/003_market_benchmarks.sql`, set `DATABASE_URL`,
 * and the factory in `lib/data/index.ts` selects it over the demo fallback.
 *
 * It reuses the same `SqlExecutor` as the market and rate repositories: these
 * are tables in one database, not separate systems. The *interfaces* are
 * separate so the sources can be switched independently; the connection is not.
 */
export class PostgresMarketBenchmarkRepository implements MarketBenchmarkRepository {
  readonly name = "PostgreSQL";
  readonly dataQuality = "live" as const;

  constructor(private readonly query: SqlExecutor) {}

  async getLatest(seriesCode: BenchmarkSeriesCode): Promise<BenchmarkObservation | null> {
    const rows = await this.query<Record<string, unknown>>(
      `SELECT series_code, to_char(observation_date, 'YYYY-MM-DD') AS observation_date,
              value, source, retrieved_at, data_quality
         FROM market_benchmarks
        WHERE series_code = $1
        ORDER BY observation_date DESC
        LIMIT 1`,
      [seriesCode],
    );
    return rows[0] ? toObservation(rows[0]) : null;
  }

  async getPrevious(
    seriesCode: BenchmarkSeriesCode,
    observationDate: string,
  ): Promise<BenchmarkObservation | null> {
    const rows = await this.query<Record<string, unknown>>(
      `SELECT series_code, to_char(observation_date, 'YYYY-MM-DD') AS observation_date,
              value, source, retrieved_at, data_quality
         FROM market_benchmarks
        WHERE series_code = $1 AND observation_date < $2::date
        ORDER BY observation_date DESC
        LIMIT 1`,
      [seriesCode, observationDate],
    );
    return rows[0] ? toObservation(rows[0]) : null;
  }

  async getHistory(query: BenchmarkHistoryQuery): Promise<BenchmarkObservation[]> {
    // A limit has to take the *most recent* rows, so the inner query orders
    // descending and the outer one restores ascending for the chart. Ordering
    // ascending and limiting would return the oldest rows instead.
    const rows = await this.query<Record<string, unknown>>(
      `SELECT * FROM (
         SELECT series_code, to_char(observation_date, 'YYYY-MM-DD') AS observation_date,
                value, source, retrieved_at, data_quality, observation_date AS sort_key
           FROM market_benchmarks
          WHERE series_code = $1
            AND ($2::date IS NULL OR observation_date >= $2::date)
            AND ($3::date IS NULL OR observation_date <= $3::date)
          ORDER BY observation_date DESC
          LIMIT COALESCE($4::int, 100000)
       ) recent
       ORDER BY sort_key ASC`,
      [query.seriesCode, query.startDate ?? null, query.endDate ?? null, query.limit ?? null],
    );
    return rows.map(toObservation);
  }

  async upsertObservations(observations: BenchmarkObservation[]): Promise<number> {
    if (observations.length === 0) return 0;

    // One statement with unnested arrays rather than a loop: a five-year
    // backfill is ~1,250 rows, and 1,250 round trips is the difference between
    // an import that takes a second and one that takes a minute.
    const rows = await this.query<{ written: string }>(
      `INSERT INTO market_benchmarks
         (series_code, observation_date, value, source, retrieved_at, data_quality)
       SELECT * FROM unnest(
         $1::text[], $2::date[], $3::numeric[], $4::text[], $5::timestamptz[], $6::text[]
       )
       ON CONFLICT (series_code, observation_date) DO UPDATE
         SET value        = EXCLUDED.value,
             source       = EXCLUDED.source,
             retrieved_at = EXCLUDED.retrieved_at,
             data_quality = EXCLUDED.data_quality,
             updated_at   = now()
       RETURNING 1 AS written`,
      [
        observations.map((o) => o.seriesCode),
        observations.map((o) => o.observationDate),
        observations.map((o) => o.value),
        observations.map((o) => o.source),
        observations.map((o) => o.retrievedAt),
        observations.map((o) => o.dataQuality),
      ],
    );
    return rows.length;
  }
}

/**
 * Import-run audit backed by the `import_runs` table from the initial schema,
 * extended by migration 003 with the received/rejected counts.
 */
export class PostgresImportRunStore implements ImportRunStore {
  readonly name = "PostgreSQL import_runs";

  constructor(private readonly query: SqlExecutor) {}

  async startRun(input: StartRunInput): Promise<string> {
    const rows = await this.query<{ id: string }>(
      `INSERT INTO import_runs (data_source_id, status, triggered_by, metadata)
       VALUES ($1, 'running', $2, $3::jsonb)
       RETURNING id::text AS id`,
      [input.dataSourceId, input.triggeredBy, JSON.stringify(input.metadata ?? {})],
    );
    return rows[0].id;
  }

  async completeRun(runId: string, input: CompleteRunInput): Promise<void> {
    await this.query(
      `UPDATE import_runs
          SET completed_at      = now(),
              status            = $2,
              records_imported  = $3,
              records_received  = $4,
              records_rejected  = $5,
              error_message     = $6,
              error_kind        = $7,
              metadata          = metadata || $8::jsonb
        WHERE id = $1::bigint`,
      [
        runId,
        input.status,
        input.recordsWritten,
        input.recordsReceived,
        input.recordsRejected,
        input.errorMessage ?? null,
        input.errorKind ?? null,
        JSON.stringify(input.metadata ?? {}),
      ],
    );
  }

  async listRuns(dataSourceId?: string, limit = 20): Promise<ImportRun[]> {
    const rows = await this.query<Record<string, unknown>>(
      `SELECT id::text AS id, data_source_id, started_at, completed_at, status,
              records_imported, error_message, triggered_by
         FROM import_runs
        WHERE ($1::text IS NULL OR data_source_id = $1)
        ORDER BY started_at DESC
        LIMIT $2`,
      [dataSourceId ?? null, limit],
    );
    return rows.map(toImportRun);
  }

  async getHealth(dataSourceId: string): Promise<ImportHealth> {
    const rows = await this.query<Record<string, unknown>>(
      `SELECT status, started_at, completed_at, records_imported, error_message, error_kind
         FROM import_runs
        WHERE data_source_id = $1
        ORDER BY started_at DESC
        LIMIT 50`,
      [dataSourceId],
    );

    return summariseHealth(
      dataSourceId,
      rows.map((row) => ({
        status: row.status as ImportRun["status"],
        startedAt: new Date(String(row.started_at)).toISOString(),
        completedAt: row.completed_at ? new Date(String(row.completed_at)).toISOString() : null,
        recordsImported: Number(row.records_imported ?? 0),
        errorMessage: row.error_message ? String(row.error_message) : null,
        errorKind: row.error_kind ? String(row.error_kind) : null,
      })),
    );
  }
}

function toObservation(row: Record<string, unknown>): BenchmarkObservation {
  return {
    seriesCode: String(row.series_code) as BenchmarkSeriesCode,
    observationDate: String(row.observation_date),
    value: Number(row.value),
    source: String(row.source),
    retrievedAt: new Date(String(row.retrieved_at)).toISOString(),
    dataQuality: row.data_quality as BenchmarkObservation["dataQuality"],
  };
}

function toImportRun(row: Record<string, unknown>): ImportRun {
  return {
    id: String(row.id),
    dataSourceId: String(row.data_source_id),
    startedAt: new Date(String(row.started_at)).toISOString(),
    completedAt: row.completed_at ? new Date(String(row.completed_at)).toISOString() : null,
    status: row.status as ImportRun["status"],
    recordsImported: Number(row.records_imported ?? 0),
    errorMessage: row.error_message ? String(row.error_message) : null,
    triggeredBy: row.triggered_by as ImportRun["triggeredBy"],
  };
}
