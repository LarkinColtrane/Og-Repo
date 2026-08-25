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
   * `demo` while the app is served from the generated dataset, `live` once a
   * real database backs the repository. The UI must not present `demo` numbers
   * as verified market information.
   */
  dataQuality: "demo" | "live";
  /** The reporting month the payload describes. */
  period: string;
  sources: Attribution[];
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
