import type { SqlExecutor } from "@/lib/data/postgres-repository";
import type { BoroughPermitStat } from "@/types/civic";

/**
 * An in-memory stand-in for the `civic_permit_stats` table.
 *
 * It does not parse SQL. It recognises the statements the civic repository
 * issues and applies the same *semantics* — chiefly the `(borough_code, period)`
 * upsert — so the repository's behaviour can be tested without a database.
 *
 * Two properties it reproduces faithfully, because the tests turn on them:
 *
 *  - **Upsert, not insert.** Writing the same key twice replaces, never doubles.
 *  - **No delete path exists.** There is no statement here that removes a row,
 *    mirroring the repository, which has none either. A test asserting "a bad
 *    import cannot erase history" is only meaningful if the fake could in
 *    principle have deleted something — so `deleteCalls` counts any attempt.
 *
 * That is a real limit and worth stating: this proves the repository's logic, not
 * that the SQL is syntactically valid. Only a live database proves the latter.
 */
export interface FakeCivicDb {
  executeSql: SqlExecutor;
  rows: Map<string, BoroughPermitStat>;
  queries: string[];
  deleteCalls: number;
  failNext: (message: string) => void;
}

export function createFakeCivicDb(seed: BoroughPermitStat[] = []): FakeCivicDb {
  const rows = new Map<string, BoroughPermitStat>();
  for (const row of seed) rows.set(`${row.boroughCode}:${row.period}`, row);

  const queries: string[] = [];
  let pendingFailure: string | null = null;
  const state = { deleteCalls: 0 };

  const executeSql: SqlExecutor = async <TRow = Record<string, unknown>>(
    sql: string,
    params: unknown[] = [],
  ): Promise<TRow[]> => {
    queries.push(sql.trim().split("\n")[0]);

    if (/\bDELETE\b|\bTRUNCATE\b/i.test(sql)) {
      state.deleteCalls += 1;
      throw new Error("The civic repository must never delete rows.");
    }

    if (pendingFailure) {
      const message = pendingFailure;
      pendingFailure = null;
      throw new Error(message);
    }

    if (sql.includes("INSERT INTO civic_permit_stats")) {
      const [boroughs, periods, permits, units, values, categories, sources, retrieved, qualities] =
        params as [
          string[], string[], number[], Array<number | null>,
          Array<number | null>, string[], string[], string[], string[],
        ];
      const written: TRow[] = [];
      boroughs.forEach((borough, i) => {
        rows.set(`${borough}:${periods[i]}`, {
          boroughCode: borough,
          period: periods[i],
          permitsIssued: permits[i],
          dwellingUnitsCreated: units[i],
          declaredWorkValue: values[i],
          byCategory: JSON.parse(categories[i]),
          dataSourceId: sources[i],
          retrievedAt: retrieved[i],
          dataQuality: qualities[i] as BoroughPermitStat["dataQuality"],
        });
        written.push({ written: 1 } as TRow);
      });
      return written;
    }

    if (sql.includes("MAX(period)")) {
      const periods = [...rows.values()].map((row) => row.period).sort();
      return [{ period: periods[periods.length - 1] ?? null }] as TRow[];
    }

    if (sql.includes("DISTINCT borough_code")) {
      const codes = [...new Set([...rows.values()].map((row) => row.boroughCode))].sort();
      return codes.map((borough_code) => ({ borough_code })) as TRow[];
    }

    if (sql.includes("FROM civic_permit_stats")) {
      const [borough, from, to, limit] = params as [
        string | null, string | null, string | null, number | null,
      ];
      let all = [...rows.values()]
        .filter(
          (row) =>
            (!borough || row.boroughCode === borough) &&
            (!from || row.period >= from) &&
            (!to || row.period <= to),
        )
        .sort(
          (a, b) =>
            a.period.localeCompare(b.period) || a.boroughCode.localeCompare(b.boroughCode),
        );

      // Mirror the real query: a limit takes the most recent rows.
      if (limit !== null && all.length > limit) all = all.slice(all.length - limit);
      return all.map(toRow) as TRow[];
    }

    return [] as TRow[];
  };

  return {
    executeSql,
    rows,
    queries,
    get deleteCalls() {
      return state.deleteCalls;
    },
    failNext: (message: string) => {
      pendingFailure = message;
    },
  };
}

function toRow(stat: BoroughPermitStat): Record<string, unknown> {
  return {
    borough_code: stat.boroughCode,
    period: stat.period,
    permits_issued: stat.permitsIssued,
    dwelling_units_created: stat.dwellingUnitsCreated,
    // `numeric` comes back from node-postgres as a string. Reproducing that is
    // the point: it is how a real driver behaves and how a naive mapper breaks.
    declared_work_value:
      stat.declaredWorkValue === null ? null : String(stat.declaredWorkValue),
    by_category: stat.byCategory,
    data_source_id: stat.dataSourceId,
    retrieved_at: stat.retrievedAt,
    data_quality: stat.dataQuality,
  };
}
