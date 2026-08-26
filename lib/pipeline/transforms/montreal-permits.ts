import type { BoroughPermitStat, PermitCategory } from "@/types/civic";
import { PERMIT_CATEGORIES } from "@/types/civic";
import type { Period } from "@/types";
import { normalizeBoroughName } from "@/lib/geo/montreal";
import {
  classifyPermitCategory,
  type DatasetDefinition,
  type ResolvedFields,
} from "@/lib/pipeline/connectors/montreal-open-data/datasets";

/**
 * Permit rows → borough-month statistics.
 *
 * A pure function: rows in, records out, no I/O and no clock. `retrievedAt` is
 * injected rather than read from `Date.now()` so a test can assert on the exact
 * output, and so the same batch normalized twice is byte-identical.
 *
 * ## What this layer is responsible for
 *
 *  1. **Resolving geography.** Every borough name goes through
 *     `normalizeBoroughName`, which returns `null` rather than guessing. A row
 *     naming a place the registry does not know is rejected and appears in the
 *     import report — it is never filed under the nearest match.
 *  2. **Bucketing to a period.** Permits are issued on dates; the platform
 *     reports months. One transaction date becomes one `YYYY-MM`.
 *  3. **Aggregating.** Individual permits are not published here — only
 *     borough-month totals. That is a deliberate limit, not an oversight: see
 *     the note on aggregation below.
 *  4. **Reporting what it refused.** Every rejected row carries a reason.
 *
 * ## Why the output is aggregated
 *
 * A permit record identifies a specific address. Republishing those individually
 * would turn an open dataset about municipal process into an address-level
 * feed, which is a different thing with different implications, and this
 * platform has no use for it — everything it shows is neighbourhood or borough
 * scale. Aggregating in the transform means address-level rows never reach
 * storage at all, rather than being stored and then filtered on read.
 */

export interface PermitRowRejection {
  /** Index in the input batch, so the offending row can be found. */
  index: number;
  reason:
    | "unknown-borough"
    | "missing-borough"
    | "missing-date"
    | "unparseable-date"
    | "ambiguous-date";
  message: string;
  /** The raw value that could not be used. Truncated; never a whole record. */
  value: string | null;
}

export interface NormalizeResult {
  stats: BoroughPermitStat[];
  rejected: PermitRowRejection[];
  /** Rows the publisher returned. */
  received: number;
  /** Rows that contributed to a statistic. */
  accepted: number;
  /** Borough names seen that the registry does not know, deduplicated. */
  unknownBoroughs: string[];
  /** Periods covered, ascending. */
  periods: Period[];
}

export interface NormalizeOptions {
  dataset: DatasetDefinition;
  fields: ResolvedFields;
  /** ISO timestamp of the fetch. Injected for determinism. */
  retrievedAt: string;
  /** Only keep periods at or after this bound, when set. */
  from?: Period;
  /** Only keep periods at or before this bound, when set. */
  to?: Period;
}

interface Bucket {
  boroughCode: string;
  period: Period;
  permitsIssued: number;
  dwellingUnits: number;
  /** Whether any row in this bucket carried a unit count. */
  sawDwellingUnits: boolean;
  declaredValue: number;
  sawDeclaredValue: boolean;
  byCategory: Record<PermitCategory, number>;
}

export function normalizeMontrealPermits(
  records: Array<Record<string, unknown>>,
  options: NormalizeOptions,
): NormalizeResult {
  const { fields, retrievedAt, dataset } = options;
  const buckets = new Map<string, Bucket>();
  const rejected: PermitRowRejection[] = [];
  const unknownBoroughs = new Set<string>();
  let accepted = 0;

  records.forEach((record, index) => {
    const rawBorough = readString(record[fields.map.borough]);
    if (!rawBorough) {
      rejected.push({
        index,
        reason: "missing-borough",
        message: `Row has no value in the "${fields.map.borough}" column.`,
        value: null,
      });
      return;
    }

    const match = normalizeBoroughName(rawBorough);
    if (!match) {
      unknownBoroughs.add(rawBorough);
      rejected.push({
        index,
        reason: "unknown-borough",
        message: `"${truncate(rawBorough)}" is not a borough or linked city this platform knows. Add it to MONTREAL_MUNICIPALITIES, or to the aliases of the entry it belongs to.`,
        value: truncate(rawBorough),
      });
      return;
    }

    const rawDate = readString(record[fields.map.issuedDate]);
    if (!rawDate) {
      rejected.push({
        index,
        reason: "missing-date",
        message: `Row has no value in the "${fields.map.issuedDate}" column.`,
        value: null,
      });
      return;
    }

    const parsed = parseIssuedPeriod(rawDate);
    if (!parsed.ok) {
      rejected.push({
        index,
        reason: parsed.reason,
        message: parsed.message,
        value: truncate(rawDate),
      });
      return;
    }

    const period = parsed.period;
    if (options.from && period < options.from) return;
    if (options.to && period > options.to) return;

    accepted += 1;

    const key = `${match.municipality.code}|${period}`;
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = {
        boroughCode: match.municipality.code,
        period,
        permitsIssued: 0,
        dwellingUnits: 0,
        sawDwellingUnits: false,
        declaredValue: 0,
        sawDeclaredValue: false,
        byCategory: emptyCategories(),
      };
      buckets.set(key, bucket);
    }

    bucket.permitsIssued += 1;
    bucket.byCategory[classifyPermitCategory(record[fields.map.category])] += 1;

    const units = readNumber(record[fields.map.dwellingUnits]);
    if (units !== null) {
      bucket.dwellingUnits += units;
      bucket.sawDwellingUnits = true;
    }

    const value = readNumber(record[fields.map.declaredValue]);
    if (value !== null) {
      bucket.declaredValue += value;
      bucket.sawDeclaredValue = true;
    }
  });

  const stats: BoroughPermitStat[] = [...buckets.values()]
    .sort((a, b) => a.period.localeCompare(b.period) || a.boroughCode.localeCompare(b.boroughCode))
    .map((bucket) => ({
      boroughCode: bucket.boroughCode,
      period: bucket.period,
      permitsIssued: bucket.permitsIssued,
      // `null`, not `0`, when no row carried a count. "We do not know" and
      // "none were declared" are different facts and the interface renders
      // them differently.
      dwellingUnitsCreated: bucket.sawDwellingUnits ? bucket.dwellingUnits : null,
      declaredWorkValue: bucket.sawDeclaredValue
        ? Math.round(bucket.declaredValue)
        : null,
      byCategory: bucket.byCategory,
      dataSourceId: dataset.sourceId,
      retrievedAt,
      dataQuality: "live",
    }));

  const periods = [...new Set(stats.map((stat) => stat.period))].sort();

  return {
    stats,
    rejected,
    received: records.length,
    accepted,
    unknownBoroughs: [...unknownBoroughs].sort(),
    periods,
  };
}

function emptyCategories(): Record<PermitCategory, number> {
  const counts = {} as Record<PermitCategory, number>;
  for (const category of PERMIT_CATEGORIES) counts[category] = 0;
  return counts;
}

type PeriodParse =
  | { ok: true; period: Period }
  | { ok: false; reason: PermitRowRejection["reason"]; message: string };

/**
 * Read an issue date and reduce it to a reporting month.
 *
 * ## Why `14/03/2026` is rejected rather than parsed
 *
 * `03/04/2026` is 3 April in Québec and 4 March in the United States. Both
 * readings are plausible, both produce a *different month*, and this transform's
 * entire output is bucketed by month — so guessing wrong does not shift a
 * statistic slightly, it files it under the wrong period.
 *
 * A parser cannot resolve that from the value alone. Rejecting the row and
 * saying why puts the decision in front of a person who can look at the feed,
 * which is the correct place for it. If the publisher turns out to use
 * `DD/MM/YYYY`, that becomes one documented line here — not an assumption
 * buried in a regex.
 *
 * Unambiguous forms are accepted: ISO-8601 (`2026-03-14`, with or without a
 * time), `YYYY/MM/DD`, and a slash form whose first component is above 12 and
 * therefore can only be a day.
 */
export function parseIssuedPeriod(raw: string): PeriodParse {
  const value = raw.trim();

  // ISO-8601, the only form with no ambiguity at all.
  const iso = /^(\d{4})-(\d{2})(?:-(\d{2}))?(?:[T ].*)?$/.exec(value);
  if (iso) return monthFrom(Number(iso[1]), Number(iso[2]), value);

  // YYYY/MM/DD — year first, so equally unambiguous.
  const yearFirst = /^(\d{4})\/(\d{1,2})\/(\d{1,2})$/.exec(value);
  if (yearFirst) return monthFrom(Number(yearFirst[1]), Number(yearFirst[2]), value);

  const slash = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(value);
  if (slash) {
    const first = Number(slash[1]);
    const second = Number(slash[2]);
    const year = Number(slash[3]);
    // Above 12 the first component can only be a day, which fixes the second
    // as the month. Below that, both readings are live.
    if (first > 12) return monthFrom(year, second, value);
    return {
      ok: false,
      reason: "ambiguous-date",
      message: `"${truncate(value)}" could be day/month or month/day. Both readings give a different reporting month, so this row is rejected rather than guessed. If the publisher's format is known, record it in parseIssuedPeriod.`,
    };
  }

  return {
    ok: false,
    reason: "unparseable-date",
    message: `"${truncate(value)}" is not a date this pipeline recognises. Accepted: YYYY-MM-DD, YYYY-MM, YYYY/MM/DD.`,
  };
}

function monthFrom(year: number, month: number, raw: string): PeriodParse {
  if (!Number.isInteger(year) || year < 1900 || year > 2200) {
    return {
      ok: false,
      reason: "unparseable-date",
      message: `"${truncate(raw)}" has a year outside 1900–2200.`,
    };
  }
  if (!Number.isInteger(month) || month < 1 || month > 12) {
    return {
      ok: false,
      reason: "unparseable-date",
      message: `"${truncate(raw)}" has no month between 01 and 12.`,
    };
  }
  return { ok: true, period: `${year}-${String(month).padStart(2, "0")}` };
}

function readString(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text.length > 0 ? text : null;
}

/**
 * Read a numeric column that may arrive as a number, a string, or nothing.
 *
 * `Number("")` is `0`, which is how an empty cell becomes a confident zero in
 * every naive importer ever written. Empty, null and non-numeric all return
 * `null` here, and the caller distinguishes "no value" from "zero".
 *
 * Handles the separators a French-Canadian export produces: `1 234,56` (space
 * as thousands separator, comma as decimal) and `1,234.56`.
 */
export function readNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;

  let text = String(value).trim();
  if (text.length === 0) return null;

  text = text.replace(/[$\s  ]/g, "");
  const lastComma = text.lastIndexOf(",");
  const lastDot = text.lastIndexOf(".");

  if (lastComma !== -1 && lastDot !== -1) {
    // Whichever comes last is the decimal mark; the other groups thousands.
    if (lastComma > lastDot) text = text.replace(/\./g, "").replace(",", ".");
    else text = text.replace(/,/g, "");
  } else if (lastComma !== -1) {
    // A lone comma: a decimal mark when it separates 1–2 trailing digits
    // (`1234,5`), a thousands separator when it separates exactly 3 (`1,234`).
    const after = text.length - lastComma - 1;
    text = after === 3 ? text.replace(/,/g, "") : text.replace(",", ".");
  }

  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : null;
}

function truncate(value: string, max = 80): string {
  return value.length > max ? `${value.slice(0, max)}…` : value;
}
