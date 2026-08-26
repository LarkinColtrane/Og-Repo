import type { BoroughPermitStat, PermitCategory } from "@/types/civic";
import { PERMIT_CATEGORIES } from "@/types/civic";
import type { Period } from "@/types";
import type { BoroughCode } from "@/lib/geo/montreal";
import type { CivicDataRepository, PermitStatQuery } from "./civic-repository";
import type { SqlExecutor } from "./postgres-repository";

/**
 * PostgreSQL implementation of the civic repository.
 *
 * ── Status ──────────────────────────────────────────────────────────────
 * Written and exercised by unit tests against a fake `SqlExecutor`, but **not
 * connected** — there is no database in this repository and no driver in
 * package.json. Apply `docs/sql/004_civic_permits.sql`, set `DATABASE_URL`, and
 * the factory in `lib/data/index.ts` selects it over the demo fallback.
 *
 * It reuses the same `SqlExecutor` as the other three repositories: these are
 * tables in one database, not separate systems.
 */
export class PostgresCivicDataRepository implements CivicDataRepository {
  readonly name = "PostgreSQL";
  readonly dataQuality = "live" as const;

  constructor(private readonly query: SqlExecutor) {}

  async getPermitStats(query: PermitStatQuery): Promise<BoroughPermitStat[]> {
    // A limit has to take the *most recent* periods, so the inner query orders
    // descending and the outer one restores ascending for the chart. Ordering
    // ascending and limiting would return the oldest rows instead.
    const rows = await this.query<Record<string, unknown>>(
      `SELECT * FROM (
         SELECT borough_code, period, permits_issued, dwelling_units_created,
                declared_work_value, by_category, data_source_id,
                retrieved_at, data_quality
           FROM civic_permit_stats
          WHERE ($1::text IS NULL OR borough_code = $1)
            AND ($2::text IS NULL OR period >= $2)
            AND ($3::text IS NULL OR period <= $3)
          ORDER BY period DESC, borough_code DESC
          LIMIT COALESCE($4::int, 100000)
       ) recent
       ORDER BY period ASC, borough_code ASC`,
      [
        query.boroughCode ?? null,
        query.from ?? null,
        query.to ?? null,
        query.limit ?? null,
      ],
    );
    return rows.map(toPermitStat);
  }

  async getLatestPeriod(): Promise<Period | null> {
    const rows = await this.query<{ period: string }>(
      `SELECT MAX(period) AS period FROM civic_permit_stats`,
    );
    return rows[0]?.period ?? null;
  }

  async getReportingBoroughs(): Promise<BoroughCode[]> {
    const rows = await this.query<{ borough_code: string }>(
      `SELECT DISTINCT borough_code FROM civic_permit_stats ORDER BY borough_code`,
    );
    return rows.map((row) => row.borough_code);
  }

  /**
   * Insert or update by `(borough_code, period)`.
   *
   * `ON CONFLICT … DO UPDATE`, never `DELETE` then `INSERT`. Re-importing a
   * month that the publisher has since revised replaces those rows; a month the
   * extract does not mention is left exactly as it was. There is deliberately no
   * code path in this class that removes a row — an import cannot erase history
   * even by returning nothing, which is the property `docs/REAL_DATA_PIPELINE.md`
   * spells out and `tests/civic-persistence.test.ts` asserts.
   */
  async upsertPermitStats(stats: BoroughPermitStat[]): Promise<number> {
    if (stats.length === 0) return 0;

    // One statement with unnested arrays rather than a loop: a five-year
    // backfill across twenty boroughs is 1,200 rows, and 1,200 round trips is
    // the difference between a one-second import and a one-minute one.
    const rows = await this.query<{ written: string }>(
      `INSERT INTO civic_permit_stats
         (borough_code, period, permits_issued, dwelling_units_created,
          declared_work_value, by_category, data_source_id, retrieved_at, data_quality)
       SELECT * FROM unnest(
         $1::text[], $2::text[], $3::int[], $4::int[],
         $5::numeric[], $6::jsonb[], $7::text[], $8::timestamptz[], $9::text[]
       )
       ON CONFLICT (borough_code, period) DO UPDATE
         SET permits_issued         = EXCLUDED.permits_issued,
             dwelling_units_created = EXCLUDED.dwelling_units_created,
             declared_work_value    = EXCLUDED.declared_work_value,
             by_category            = EXCLUDED.by_category,
             data_source_id         = EXCLUDED.data_source_id,
             retrieved_at           = EXCLUDED.retrieved_at,
             data_quality           = EXCLUDED.data_quality,
             updated_at             = now()
       RETURNING 1 AS written`,
      [
        stats.map((s) => s.boroughCode),
        stats.map((s) => s.period),
        stats.map((s) => s.permitsIssued),
        stats.map((s) => s.dwellingUnitsCreated),
        stats.map((s) => s.declaredWorkValue),
        stats.map((s) => JSON.stringify(s.byCategory)),
        stats.map((s) => s.dataSourceId),
        stats.map((s) => s.retrievedAt),
        stats.map((s) => s.dataQuality),
      ],
    );
    return rows.length;
  }
}

/**
 * Map a database row to the domain type.
 *
 * `numeric` comes back from node-postgres as a **string** — it does not fit in a
 * JavaScript number in the general case, so the driver refuses to guess. Every
 * numeric column therefore goes through an explicit conversion here rather than
 * being trusted to be a number three layers up.
 */
function toPermitStat(row: Record<string, unknown>): BoroughPermitStat {
  return {
    boroughCode: String(row.borough_code),
    period: String(row.period) as Period,
    permitsIssued: Number(row.permits_issued),
    dwellingUnitsCreated: nullableNumber(row.dwelling_units_created),
    declaredWorkValue: nullableNumber(row.declared_work_value),
    byCategory: toCategories(row.by_category),
    dataSourceId: String(row.data_source_id),
    retrievedAt:
      row.retrieved_at instanceof Date
        ? row.retrieved_at.toISOString()
        : String(row.retrieved_at),
    dataQuality: row.data_quality === "live" ? "live" : "demo",
  };
}

function nullableNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * `jsonb` arrives as an object from node-postgres and as a string from some
 * pool wrappers. Accept both, and fill every category so a partial object
 * cannot produce `undefined` in an arithmetic expression downstream.
 */
function toCategories(value: unknown): Record<PermitCategory, number> {
  const parsed =
    typeof value === "string" ? safeParse(value) : ((value ?? {}) as Record<string, unknown>);
  const counts = {} as Record<PermitCategory, number>;
  for (const category of PERMIT_CATEGORIES) {
    const raw = parsed[category];
    counts[category] = Number.isFinite(Number(raw)) ? Number(raw) : 0;
  }
  return counts;
}

function safeParse(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value);
    return typeof parsed === "object" && parsed !== null
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}
