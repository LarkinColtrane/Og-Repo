import type { Attribution } from "./data-source";

/**
 * Every internal API route returns this envelope. Keeping metadata beside the
 * payload means a component always knows how fresh its numbers are and where
 * they came from, without a second request.
 */
export interface ApiResponse<T> {
  data: T;
  meta: ApiMeta;
}

export interface ApiMeta {
  /** ISO timestamp of when this response was assembled. */
  generatedAt: string;
  /**
   * Quality of the payload **as a whole**.
   *
   * `live` only when every dataset in the response is live. `mixed` when some
   * are and some are not. `demo` when none are. The asymmetry is deliberate: a
   * single live dataset must never be able to make the rest of a response look
   * verified, so this value can only ever under-claim, never over-claim.
   *
   * For anything finer than a page-level notice, read `datasets` — or, better,
   * read `isDemo` on the `Attribution` attached to the statistic itself, which
   * is what the source badges key off.
   */
  dataQuality: DataQuality;
  /**
   * Per-dataset quality, when a response carries more than one kind of data.
   *
   * Added because one flag per response stopped being enough the moment a real
   * source landed beside the generated ones. A page showing live permit counts
   * next to demo rents needs to label each honestly, and a single value for the
   * whole envelope cannot do that without lying about one of them.
   *
   * Absent on single-dataset responses, where `dataQuality` says everything.
   */
  datasets?: DatasetQuality[];
  /** The reporting month the payload describes. */
  period: string;
  sources: Attribution[];
}

export type DataQuality = "demo" | "live" | "mixed";

/** Quality of one named dataset within a response. */
export interface DatasetQuality {
  /** Stable key naming the dataset within this payload, e.g. `permits`. */
  dataset: string;
  /** Human label for a legend or a dashboard row. */
  label: string;
  quality: "demo" | "live";
  /** Data source ids backing it, resolvable in the source registry. */
  sourceIds: string[];
}

export interface ApiErrorBody {
  error: {
    code: ApiErrorCode;
    message: string;
    details?: unknown;
  };
}

export type ApiErrorCode =
  | "NOT_FOUND"
  | "INVALID_REQUEST"
  /** Shared-secret check failed on an internal write endpoint. */
  | "UNAUTHORIZED"
  | "INTERNAL_ERROR"
  | "NOT_IMPLEMENTED";

/** Query accepted by `GET /api/neighbourhoods/[slug]/sales`. */
export interface SaleStatsQuery {
  neighbourhoodId?: string;
  propertyType?: string;
  /** Inclusive lower bound, `YYYY-MM`. */
  from?: string;
  /** Inclusive upper bound, `YYYY-MM`. */
  to?: string;
  /** Convenience alternative to `from`/`to`, expressed as a trend range. */
  range?: string;
}

/** Query accepted by `GET /api/neighbourhoods/[slug]/rent`. */
export interface RentalStatsQuery {
  neighbourhoodId?: string;
  bedroomType?: string;
  from?: string;
  to?: string;
  range?: string;
}
