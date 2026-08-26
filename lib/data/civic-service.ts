import type {
  BoroughAttribution,
  BoroughPermitStat,
  CityPermitSummary,
  PermitSeriesPayload,
} from "@/types/civic";
import type { Attribution, Period } from "@/types";
import {
  describeBoroughAttribution,
  getBoroughLink,
  getMunicipality,
  type BoroughCode,
} from "@/lib/geo/montreal";
import { addMonths } from "@/lib/periods";
import { getAttributions, getCivicRepository } from "./index";
import { summarisePermitsByPeriod } from "./civic-repository";

/**
 * Assembles what the interface needs to show civic data honestly.
 *
 * The one rule this module exists to enforce: **a borough figure carries its
 * own label.** When a caller asks for permits "for Griffintown", what comes back
 * is a Le Sud-Ouest statistic plus an `attribution` object saying so, in words,
 * composed here. A page cannot print a neighbourhood name over a borough number
 * because the page does not compose that caption — this does, from the coverage
 * recorded in `lib/geo/montreal.ts`.
 *
 * That is the same principle as `dataQuality` living in the repository rather
 * than in a component prop: a label that can be forgotten will be forgotten.
 */

export interface PermitQueryOptions {
  /** Resolve the borough from a neighbourhood slug, and caption accordingly. */
  neighbourhoodSlug?: string;
  /** Or name the borough directly. */
  boroughCode?: BoroughCode;
  /** Months of history to return, counted back from the latest period. */
  months?: number;
  from?: Period;
  to?: Period;
}

export interface PermitSeriesResult extends PermitSeriesPayload {
  /** City-wide totals across every reporting borough, for the same periods. */
  city: CityPermitSummary[];
  /** Provenance for these statistics, ready for a source badge. */
  sources: Attribution[];
  /** `demo` while the fallback backs it, `live` once a real import has run. */
  dataQuality: "demo" | "live";
  /** Name of the backing store, for the operations dashboard. */
  storeName: string;
}

export async function getPermitSeries(
  options: PermitQueryOptions = {},
): Promise<PermitSeriesResult> {
  const repository = getCivicRepository();

  const link = options.neighbourhoodSlug
    ? getBoroughLink(options.neighbourhoodSlug)
    : null;
  const boroughCode = link?.boroughCode ?? options.boroughCode ?? null;

  const latestPeriod = await repository.getLatestPeriod();

  // The window ends at the latest period on record, not at today. Anchoring to
  // today would shrink the visible range whenever the data was behind, which is
  // exactly when a reader most wants to see the whole picture.
  const to = options.to ?? latestPeriod ?? undefined;
  const from =
    options.from ??
    (to && options.months ? addMonths(to, -(options.months - 1)) : undefined);

  const observations = boroughCode
    ? await repository.getPermitStats({ boroughCode, from, to })
    : [];

  // The city roll-up always spans every borough, even when one was requested —
  // it is the denominator that makes a borough number mean something.
  const cityRows = await repository.getPermitStats({ from, to });

  return {
    boroughCode,
    boroughName: boroughCode ? (getMunicipality(boroughCode)?.name ?? null) : null,
    observations,
    latestPeriod,
    attribution: link ? toAttribution(link) : null,
    city: summarisePermitsByPeriod(cityRows),
    sources: getAttributions(sourceIdsIn(observations.length > 0 ? observations : cityRows)),
    dataQuality: repository.dataQuality,
    storeName: repository.name,
  };
}

/**
 * Compose the caption a borough figure must be shown under.
 *
 * Derived from the coverage recorded in the geography layer, never written by a
 * page. A neighbourhood that is only *part of* its borough gets a qualifier
 * saying so, and the `label` is the borough's own name — so a component
 * rendering `attribution.label` physically cannot print "Griffintown" over a
 * Sud-Ouest number.
 */
function toAttribution(
  link: NonNullable<ReturnType<typeof getBoroughLink>>,
): BoroughAttribution {
  const described = describeBoroughAttribution(link);
  return {
    neighbourhoodSlug: link.neighbourhoodSlug,
    boroughCode: link.boroughCode,
    label: described.label,
    qualifier: described.qualifier,
    note: described.note,
    coverage: link.coverage,
  };
}

/**
 * Source ids present in a batch, deduplicated.
 *
 * Read from the rows rather than assumed, because a store can hold a mix: rows
 * imported before a source was renamed, or — once real ingestion runs against
 * some boroughs and not others — live and demo rows side by side. Taking the
 * ids from the data is what lets the badge tell the truth about that.
 */
function sourceIdsIn(stats: BoroughPermitStat[]): string[] {
  return [...new Set(stats.map((stat) => stat.dataSourceId))];
}
