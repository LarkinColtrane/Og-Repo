import type {
  CityOverview,
  ComparisonRow,
  DataSource,
  ImportRun,
  Neighbourhood,
  NeighbourhoodBoundary,
  NeighbourhoodSnapshot,
  Period,
  PropertyType,
  BedroomType,
  RentalMarketStat,
  SaleMarketStat,
} from "@/types";

/**
 * The data-access contract.
 *
 * This interface is the single seam between the application and wherever its
 * numbers live. Pages, API routes and components depend on `MarketDataRepository`
 * and never on the demo dataset, so replacing the implementation with one backed
 * by PostgreSQL is a matter of writing a second class and changing one factory
 * function — no component, route or type changes.
 *
 * Every method is async even though the demo implementation is synchronous. That
 * is deliberate: if the interface were synchronous today, adopting a real database
 * later would ripple through every caller.
 */
export interface MarketDataRepository {
  /** Human-readable name for the backing store, shown in the data-sources view. */
  readonly name: string;

  /** `demo` while synthetic data backs the app; `live` once real data does. */
  readonly dataQuality: "demo" | "live";

  /** The most recent reporting month with data. */
  getLatestPeriod(): Promise<Period>;

  listNeighbourhoods(): Promise<Neighbourhood[]>;
  getNeighbourhood(slug: string): Promise<Neighbourhood | null>;

  /** Latest month of every metric for one neighbourhood, ready to render. */
  getSnapshot(slug: string): Promise<NeighbourhoodSnapshot | null>;

  /** Montréal-wide roll-up. */
  getCityOverview(): Promise<CityOverview>;

  getSaleStats(filter: SaleStatsFilter): Promise<SaleMarketStat[]>;
  getRentalStats(filter: RentalStatsFilter): Promise<RentalMarketStat[]>;

  /** One row per requested neighbourhood, aligned on the latest common period. */
  getComparison(slugs: string[]): Promise<ComparisonRow[]>;

  listDataSources(): Promise<DataSource[]>;
  listImportRuns(limit?: number): Promise<ImportRun[]>;

  /**
   * Neighbourhood outlines as GeoJSON. Returns an empty array until a real
   * boundary dataset is connected — boundaries are never approximated.
   */
  getBoundaries(): Promise<NeighbourhoodBoundary[]>;
}

export interface SaleStatsFilter {
  neighbourhoodSlug?: string;
  neighbourhoodId?: string;
  propertyType?: PropertyType;
  /** Inclusive lower bound. */
  from?: Period;
  /** Inclusive upper bound. */
  to?: Period;
}

export interface RentalStatsFilter {
  neighbourhoodSlug?: string;
  neighbourhoodId?: string;
  bedroomType?: BedroomType;
  from?: Period;
  to?: Period;
}

/** Thrown when a repository is asked for something it cannot yet provide. */
export class RepositoryNotImplementedError extends Error {
  constructor(operation: string) {
    super(`This repository does not implement "${operation}" yet.`);
    this.name = "RepositoryNotImplementedError";
  }
}
