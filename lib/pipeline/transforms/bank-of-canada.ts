import type { BenchmarkObservation, BenchmarkSeriesMeta } from "@/types/benchmark";
import type {
  ValetObservationRow,
  ValetObservationsResponse,
  ValetObservationValue,
} from "@/lib/pipeline/connectors/bank-of-canada/types";

/**
 * Bank of Canada → canonical model.
 *
 * A pure function: response in, `BenchmarkObservation[]` out. No network, no
 * database, no clock of its own — `retrievedAt` is passed in so the same input
 * always produces the same output and the transform is testable without mocking
 * time.
 *
 * Three Valet quirks are absorbed here so nothing downstream has to know them:
 *
 *  1. **Values are strings.** `{"v": "3.21"}`, not `{"v": 3.21}`.
 *  2. **Gaps are empty, not missing.** A holiday inside a requested range comes
 *     back as `{"v": ""}` rather than being omitted. Those rows are dropped, not
 *     coerced — `Number("")` is `0`, and a 0% bond yield is a plausible-looking
 *     lie that would sit in the database forever.
 *  3. **The series is a dynamic key.** Each row is `{ d, [seriesName]: { v } }`,
 *     so the row has to be read by the series name we asked for.
 */

export interface NormalizeOptions {
  series: BenchmarkSeriesMeta;
  /** ISO timestamp of the fetch, stamped onto every observation. */
  retrievedAt: string;
}

export interface NormalizeResult {
  observations: BenchmarkObservation[];
  /** Rows the publisher returned with no usable value — expected, not an error. */
  skipped: SkippedObservation[];
  /** Rows the publisher returned in total, before any were dropped. */
  received: number;
}

export interface SkippedObservation {
  observationDate: string | null;
  reason: "empty-value" | "missing-series" | "unparsable-value" | "missing-date";
}

export function normalizeBankOfCanadaSeries(
  response: ValetObservationsResponse,
  options: NormalizeOptions,
): NormalizeResult {
  const rows = response.observations ?? [];
  const observations: BenchmarkObservation[] = [];
  const skipped: SkippedObservation[] = [];

  for (const row of rows) {
    const observationDate = typeof row.d === "string" ? row.d.trim() : "";
    if (!observationDate) {
      skipped.push({ observationDate: null, reason: "missing-date" });
      continue;
    }

    const cell = readSeriesCell(row, options.series.upstreamCode);
    if (cell === undefined) {
      skipped.push({ observationDate, reason: "missing-series" });
      continue;
    }

    const raw = cell.v;
    if (raw === null || raw === undefined || String(raw).trim() === "") {
      // A non-publication day inside the requested range. Normal, and dropping
      // it is what stops the chart inventing a value for a holiday.
      skipped.push({ observationDate, reason: "empty-value" });
      continue;
    }

    const value = Number(String(raw).trim());
    if (!Number.isFinite(value)) {
      skipped.push({ observationDate, reason: "unparsable-value" });
      continue;
    }

    observations.push({
      seriesCode: options.series.code,
      observationDate,
      value,
      source: options.series.sourceId,
      retrievedAt: options.retrievedAt,
      dataQuality: "live",
    });
  }

  // Ascending by date, so every consumer — chart, latest lookup, upsert — gets a
  // predictable order regardless of what the publisher sent.
  observations.sort((a, b) => a.observationDate.localeCompare(b.observationDate));

  return { observations, skipped, received: rows.length };
}

/**
 * Pull the value cell for one series out of a row.
 *
 * Returns `undefined` when the row has no cell for this series at all, which is
 * different from a cell holding an empty value — the first means we asked for
 * the wrong thing, the second means the market was closed.
 */
function readSeriesCell(
  row: ValetObservationRow,
  upstreamCode: string,
): ValetObservationValue | undefined {
  const cell = row[upstreamCode];
  if (cell === undefined || cell === null) return undefined;
  if (typeof cell === "string") return { v: cell };
  if (typeof cell === "object" && "v" in cell) return cell as ValetObservationValue;
  return undefined;
}
