import type { Period } from "./market";
import type { BoroughCode } from "@/lib/geo/montreal";

/**
 * Civic data: statistics published by the municipality about the built
 * environment, as opposed to market statistics about transactions.
 *
 * The first one is **construction permits** — how much building is being
 * authorised, where, and of what kind. It is the supply side of a market this
 * platform otherwise describes only from the demand side.
 *
 * ## The distinction that matters most
 *
 * > ### A permit is not a home
 * >
 * > A permit is *authorisation to build*, issued at the start of a process that
 * > takes months or years and sometimes never finishes. A permit issued in March
 * > is not a dwelling anyone can live in in March, and some permits are never
 * > acted on at all.
 * >
 * > **Declared work value is not construction cost.** It is a figure the
 * > applicant states on the form, used to calculate the permit fee. It is a
 * > useful relative signal — a borough whose declared value doubles is doing
 * > more building — and a poor absolute one.
 *
 * Same shape of caution as "a bond yield is not a mortgage rate": the number is
 * real and worth showing, but it measures something adjacent to what a reader
 * will assume.
 *
 * ## Geography
 *
 * Permits are published per **borough**, and boroughs are not neighbourhoods.
 * Every statistic here is keyed on a `BoroughCode` from `lib/geo/montreal.ts`,
 * never on a neighbourhood slug, so the two cannot be conflated by accident. The
 * link between them — and the caveat that goes with it — lives in
 * `NEIGHBOURHOOD_BOROUGH_LINKS`.
 */

export type PermitCategory =
  /** New buildings. */
  | "new-construction"
  /** Alteration, addition, repair of an existing building. */
  | "renovation"
  /** Demolition, in whole or part. */
  | "demolition"
  /**
   * Recognised permits whose category this platform does not classify.
   *
   * Deliberately a real bucket rather than a silent drop: if the publisher adds
   * a category, the count still balances and the unclassified share becomes
   * visible instead of the total quietly shrinking.
   */
  | "other";

export const PERMIT_CATEGORIES: readonly PermitCategory[] = [
  "new-construction",
  "renovation",
  "demolition",
  "other",
];

/** One borough-month of permit activity. The natural key is `(borough, period)`. */
export interface BoroughPermitStat {
  boroughCode: BoroughCode;
  /** Reporting month, `YYYY-MM`. */
  period: Period;
  /** Permits issued in the month. */
  permitsIssued: number;
  /**
   * Dwelling units the permits declare creating.
   *
   * `null` when the feed carries no unit count — which is different from zero,
   * and the interface must not print "0 units" for "we do not know".
   */
  dwellingUnitsCreated: number | null;
  /** Sum of declared work value, CAD. `null` when the feed carries none. */
  declaredWorkValue: number | null;
  /** Permit counts by category. Sums to `permitsIssued`. */
  byCategory: Record<PermitCategory, number>;
  /** Data source id, resolvable in the source registry. */
  dataSourceId: string;
  /** ISO timestamp of when this was fetched from the publisher. */
  retrievedAt: string;
  /** `live` once a real import writes it; `demo` for the generated fallback. */
  dataQuality: CivicDataQuality;
}

export type CivicDataQuality = "live" | "demo";

/** Roll-up across boroughs for one month, for the city-level view. */
export interface CityPermitSummary {
  period: Period;
  permitsIssued: number;
  dwellingUnitsCreated: number | null;
  declaredWorkValue: number | null;
  byCategory: Record<PermitCategory, number>;
  /** How many boroughs reported in this month. */
  boroughsReporting: number;
  dataQuality: CivicDataQuality;
}

/** What `GET /api/civic/permits` returns. */
export interface PermitSeriesPayload {
  /** The borough these statistics describe, or null for a city roll-up. */
  boroughCode: BoroughCode | null;
  boroughName: string | null;
  observations: BoroughPermitStat[];
  latestPeriod: Period | null;
  /**
   * Present when the request named a neighbourhood: what the borough figure
   * does and does not describe. Read by the UI to caption the numbers — never
   * composed in a component.
   */
  attribution: BoroughAttribution | null;
}

export interface BoroughAttribution {
  neighbourhoodSlug: string;
  boroughCode: BoroughCode;
  /** The name the interface must print over these numbers. */
  label: string;
  /** e.g. "Borough-wide figure — wider than this neighbourhood". */
  qualifier: string;
  note: string;
  coverage: "coextensive" | "part-of";
}
