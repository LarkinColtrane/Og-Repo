/**
 * Core market vocabulary.
 *
 * These types are the contract between every layer of the app: the demo dataset,
 * the repository, the internal API routes and the React components all speak in
 * terms of the shapes declared here. Swapping the demo dataset for PostgreSQL
 * should not require changing anything in this file.
 */

/** Residential property categories tracked by the platform. */
export type PropertyType = "condo" | "house" | "plex";

export const PROPERTY_TYPES: readonly PropertyType[] = ["condo", "house", "plex"];

/** Rental unit sizes, following the CMHC-style bedroom breakdown. */
export type BedroomType = "studio" | "oneBedroom" | "twoBedroom" | "threeBedroom";

export const BEDROOM_TYPES: readonly BedroomType[] = [
  "studio",
  "oneBedroom",
  "twoBedroom",
  "threeBedroom",
];

/**
 * A reporting period, always the first day of a month in ISO form: `2026-06`.
 * Monthly granularity is what public housing data (CMHC, municipal open data)
 * realistically supports.
 */
export type Period = string;

/** Windows the UI offers for historical charts. */
export type TrendRange = "1y" | "3y" | "5y";

export const TREND_RANGES: readonly TrendRange[] = ["1y", "3y", "5y"];

/** Number of months of history each range covers. */
export const TREND_RANGE_MONTHS: Record<TrendRange, number> = {
  "1y": 12,
  "3y": 36,
  "5y": 60,
};

/**
 * Sale-side statistics for one neighbourhood, one property type, one month.
 * Mirrors the `sale_market_stats` table documented in docs/DATABASE_SCHEMA.md.
 */
export interface SaleMarketStat {
  neighbourhoodId: string;
  period: Period;
  propertyType: PropertyType;
  medianPrice: number;
  averagePricePerSqFt: number;
  activeListings: number;
  newListings: number;
  salesCount: number;
  averageDaysOnMarket: number;
  /**
   * Percentage change in `medianPrice` against the same month one year earlier.
   * Derived from the series itself, never authored by hand. `null` when there is
   * no comparison period on record.
   */
  yearOverYearChange: number | null;
  /**
   * Sale price as a percentage of asking price. Above 100 means properties are
   * generally selling over asking.
   */
  listingToSaleRatio: number;
  dataSourceId: string;
}

/**
 * Rental statistics for one neighbourhood, one unit size, one month.
 * Mirrors the `rental_market_stats` table.
 */
export interface RentalMarketStat {
  neighbourhoodId: string;
  period: Period;
  bedroomType: BedroomType;
  averageRent: number;
  medianRent: number;
  vacancyRate: number;
  yearOverYearChange: number | null;
  dataSourceId: string;
}

/** How tilted the market is toward buyers or sellers, as a computed classification. */
export type MarketConditionLabel = "buyers" | "balanced" | "sellers";

/**
 * The output of `classifyMarketCondition`. `score` runs 0 (deep buyer's market)
 * to 100 (deep seller's market); `factors` exposes each input so the UI can show
 * its work rather than asserting a conclusion.
 */
export interface MarketCondition {
  label: MarketConditionLabel;
  score: number;
  factors: MarketConditionFactor[];
}

export interface MarketConditionFactor {
  key: "monthsOfInventory" | "daysOnMarket" | "listingToSaleRatio" | "priceMomentum";
  /** The raw measured value. */
  value: number;
  /** That value normalised to 0–100 on the buyer's→seller's axis. */
  contribution: number;
  /** How much this factor counts toward the overall score (weights sum to 1). */
  weight: number;
}

/**
 * The latest month of every metric for one neighbourhood, pre-assembled so a
 * dashboard can render from a single fetch.
 */
export interface NeighbourhoodSnapshot {
  neighbourhoodId: string;
  slug: string;
  name: string;
  period: Period;
  /**
   * Partial by design: not every neighbourhood has every property type. Griffintown
   * has effectively no detached houses, so the key is simply absent and the UI shows
   * an empty state instead of a fabricated number.
   */
  sale: Partial<Record<PropertyType, SaleMarketStat>>;
  rent: Record<BedroomType, RentalMarketStat>;
  /** Property types with data here, in display order. */
  availablePropertyTypes: PropertyType[];
  vacancyRate: number;
  condition: MarketCondition;
  /** Prose generated from the numbers above — see lib/calculations/summary.ts. */
  summary: string;
}

/** City-wide roll-up used by the homepage snapshot and as a comparison baseline. */
export interface CityOverview {
  period: Period;
  medianCondoPrice: number;
  medianHousePrice: number;
  medianPlexPrice: number;
  averageOneBedroomRent: number;
  averageTwoBedroomRent: number;
  vacancyRate: number;
  averageDaysOnMarket: number;
  activeListings: number;
  /**
   * Year-over-year change for each headline metric above, as a percentage —
   * except `vacancyRate`, which is a difference in percentage points, because a
   * percentage change of a rate reads as something it is not.
   */
  changes: {
    medianCondoPrice: number | null;
    medianHousePrice: number | null;
    medianPlexPrice: number | null;
    averageOneBedroomRent: number | null;
    averageTwoBedroomRent: number | null;
    vacancyRate: number | null;
    averageDaysOnMarket: number | null;
    activeListings: number | null;
  };
}

/** One row of a neighbourhood-vs-neighbourhood comparison. */
export interface ComparisonRow {
  slug: string;
  name: string;
  medianCondoPrice: number | null;
  pricePerSqFt: number | null;
  oneBedroomRent: number;
  twoBedroomRent: number;
  vacancyRate: number;
  averageDaysOnMarket: number;
  priceYoyChange: number | null;
  rentYoyChange: number | null;
  condition: MarketConditionLabel;
}

/** A single point in a chart series. */
export interface TrendPoint {
  period: Period;
  value: number;
}

/** A named series plus its points, ready to hand to a chart component. */
export interface TrendSeries {
  key: string;
  label: string;
  points: TrendPoint[];
}
