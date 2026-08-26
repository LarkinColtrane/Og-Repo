/**
 * Mortgage-rate vocabulary.
 *
 * These types are deliberately kept apart from `types/market.ts`. Market
 * statistics and lender pricing are different data with different owners,
 * different refresh cadences and different licensing — coupling them would mean a
 * rate refresh had to know about neighbourhoods, and a market import had to know
 * about banks. They meet only in the calculation layer, which takes a price from
 * one and a rate from the other.
 */

export type LenderKind =
  /** A Schedule I chartered bank. */
  | "bank"
  /** A financial cooperative — Desjardins in Québec. */
  | "cooperative";

export interface Lender {
  /** Stable slug, e.g. `rbc`. Used in URLs and as the rate foreign key. */
  id: string;
  /** Full legal-ish name shown in detail views. */
  name: string;
  /** Compact label for tables and matrix headers. */
  shortName: string;
  kind: LenderKind;
  /** Where the institution is headquartered. Context, not a ranking. */
  headquarters: string;
  /** The lender's own mortgage page, for a reader who wants a real quote. */
  url: string;
  /** Display order in tables. Lower sorts first. */
  displayOrder: number;
}

/** Fixed or variable. Both are quoted as a nominal annual percentage. */
export type MortgageProductType = "fixed" | "variable";

export const MORTGAGE_PRODUCT_TYPES: readonly MortgageProductType[] = [
  "fixed",
  "variable",
];

/**
 * How the borrower is priced.
 *
 * This is not cosmetic. In Canada an insured mortgage — under 20% down, with a
 * default-insurance premium attached — is *less* risky to the lender, so it is
 * usually quoted at a **lower** rate than an uninsured one. A comparison that
 * used one rate for every down-payment level would get the direction of that
 * trade-off wrong.
 */
export type BorrowerProfile = "insured" | "uninsured";

/** Terms this platform tracks, in years. */
export const FIXED_TERMS = [1, 2, 3, 5, 7, 10] as const;
export const VARIABLE_TERMS = [3, 5] as const;

/**
 * One quoted rate: one lender, one product, one term, one borrower profile.
 *
 * The metadata below is the point of the shape. A rate with no effective date
 * and no source is a number someone typed, and there is no way to tell later
 * whether it was ever true.
 */
export interface MortgageRate {
  /** `demo-rbc-fixed-5-uninsured` — deterministic, so an upsert is idempotent. */
  id: string;
  lenderId: string;
  productType: MortgageProductType;
  /** Term length in years — how long the rate is held, not the amortization. */
  termYears: number;
  borrowerProfile: BorrowerProfile;
  /** Nominal annual rate as a percentage, e.g. 4.79. */
  rate: number;
  /** ISO date the rate took effect at the lender. */
  effectiveDate: string;
  /** Points at a row in the data source registry. */
  dataSourceId: string;
  /**
   * `demo` while these are generated, `live` once a real feed writes them.
   * The UI reads this field rather than assuming — see `RateQualityBadge`.
   */
  dataQuality: "demo" | "live";
  /** ISO timestamp of when this row was last written. */
  lastUpdated: string;
}

/** Filter accepted by `MortgageRateRepository.listRates`. */
export interface MortgageRateFilter {
  lenderId?: string;
  productType?: MortgageProductType;
  termYears?: number;
  borrowerProfile?: BorrowerProfile;
}

/**
 * How the property will be occupied. This drives eligibility: Canadian default
 * insurance is generally unavailable on a property the borrower will not live in,
 * which puts a hard 20% floor on a pure rental purchase.
 */
export type OccupancyType = "owner-occupied" | "investment";

export const OCCUPANCY_TYPES: readonly OccupancyType[] = [
  "owner-occupied",
  "investment",
];
