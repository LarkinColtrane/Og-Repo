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
import { PROPERTY_TYPES } from "@/types";
import {
  DATA_SOURCES,
  DEMO_IMPORT_RUNS,
  NEIGHBOURHOOD_SEEDS,
  getDemoDataset,
  type NeighbourhoodSeed,
} from "@/data/demo";
import { addMonths, comparePeriods } from "@/lib/periods";
import {
  classifyMarketCondition,
  monthsOfInventory,
} from "@/lib/calculations/market-condition";
import { buildMarketSummary } from "@/lib/calculations/summary";
import {
  percentChange,
  pointChange,
  sum,
  weightedMean,
  weightedMedian,
} from "@/lib/calculations/aggregate";
import type {
  MarketDataRepository,
  RentalStatsFilter,
  SaleStatsFilter,
} from "./repository";

/**
 * Repository backed by the generated demo dataset.
 *
 * It reads from memory, but it is written the way a database-backed repository is:
 * filters are applied in one place, derived metrics are computed by the shared
 * calculation modules rather than inline, and nothing here knows about React.
 * A `PostgresMarketDataRepository` implementing the same interface can be dropped
 * in beside it — see postgres-repository.ts for the sketch.
 */
export class DemoMarketDataRepository implements MarketDataRepository {
  readonly name = "In-memory demo dataset";
  readonly dataQuality = "demo" as const;

  private seedsBySlug = new Map<string, NeighbourhoodSeed>(
    NEIGHBOURHOOD_SEEDS.map((seed) => [seed.slug, seed]),
  );
  private seedsById = new Map<string, NeighbourhoodSeed>(
    NEIGHBOURHOOD_SEEDS.map((seed) => [seed.id, seed]),
  );

  /** The city roll-up scans every row, so it is computed once and reused. */
  private cityOverviewCache: CityOverview | null = null;

  async getLatestPeriod(): Promise<Period> {
    return getDemoDataset().latestPeriod;
  }

  async listNeighbourhoods(): Promise<Neighbourhood[]> {
    return NEIGHBOURHOOD_SEEDS.map(toNeighbourhood).sort((a, b) =>
      a.name.localeCompare(b.name),
    );
  }

  async getNeighbourhood(slug: string): Promise<Neighbourhood | null> {
    const seed = this.seedsBySlug.get(slug);
    return seed ? toNeighbourhood(seed) : null;
  }

  async getSaleStats(filter: SaleStatsFilter): Promise<SaleMarketStat[]> {
    const id = this.resolveId(filter.neighbourhoodSlug, filter.neighbourhoodId);
    return getDemoDataset()
      .saleStats.filter((row) => {
        if (id && row.neighbourhoodId !== id) return false;
        if (filter.propertyType && row.propertyType !== filter.propertyType) return false;
        if (filter.from && comparePeriods(row.period, filter.from) < 0) return false;
        if (filter.to && comparePeriods(row.period, filter.to) > 0) return false;
        return true;
      })
      .sort(byPeriod);
  }

  async getRentalStats(filter: RentalStatsFilter): Promise<RentalMarketStat[]> {
    const id = this.resolveId(filter.neighbourhoodSlug, filter.neighbourhoodId);
    return getDemoDataset()
      .rentalStats.filter((row) => {
        if (id && row.neighbourhoodId !== id) return false;
        if (filter.bedroomType && row.bedroomType !== filter.bedroomType) return false;
        if (filter.from && comparePeriods(row.period, filter.from) < 0) return false;
        if (filter.to && comparePeriods(row.period, filter.to) > 0) return false;
        return true;
      })
      .sort(byPeriod);
  }

  async getSnapshot(slug: string): Promise<NeighbourhoodSnapshot | null> {
    const seed = this.seedsBySlug.get(slug);
    if (!seed) return null;

    const dataset = getDemoDataset();
    const period = dataset.latestPeriod;

    const sale: Partial<Record<PropertyType, SaleMarketStat>> = {};
    for (const stat of dataset.saleStats) {
      if (stat.neighbourhoodId === seed.id && stat.period === period) {
        sale[stat.propertyType] = stat;
      }
    }

    const rent = {} as Record<BedroomType, RentalMarketStat>;
    for (const stat of dataset.rentalStats) {
      if (stat.neighbourhoodId === seed.id && stat.period === period) {
        rent[stat.bedroomType] = stat;
      }
    }

    // The dominant property type drives the headline condition: using condos for a
    // borough that is almost entirely plexes would describe the wrong market.
    const dominant = dominantPropertyType(seed);
    const leadStat = sale[dominant];
    if (!leadStat) return null;

    const moi = monthsOfInventory(leadStat.activeListings, leadStat.salesCount);
    const condition = classifyMarketCondition({
      monthsOfInventory: moi,
      averageDaysOnMarket: leadStat.averageDaysOnMarket,
      listingToSaleRatio: leadStat.listingToSaleRatio,
      priceMomentum: leadStat.yearOverYearChange,
    });

    const cityOverview = await this.getCityOverview();

    return {
      neighbourhoodId: seed.id,
      slug: seed.slug,
      name: seed.name,
      period,
      sale,
      rent,
      availablePropertyTypes: PROPERTY_TYPES.filter((type) => sale[type] !== undefined),
      vacancyRate: rent.twoBedroom?.vacancyRate ?? seed.vacancyRate,
      condition,
      summary: buildMarketSummary({
        neighbourhoodName: seed.name,
        priceChange: leadStat.yearOverYearChange,
        priceChangeType: PROPERTY_TYPE_NOUNS[dominant],
        averageDaysOnMarket: leadStat.averageDaysOnMarket,
        monthsOfInventory: moi,
        vacancyRate: rent.twoBedroom?.vacancyRate ?? seed.vacancyRate,
        cityVacancyRate: cityOverview.vacancyRate,
        rentChange: rent.twoBedroom?.yearOverYearChange ?? null,
        condition: condition.label,
      }),
    };
  }

  async getCityOverview(): Promise<CityOverview> {
    if (this.cityOverviewCache) return this.cityOverviewCache;

    const dataset = getDemoDataset();
    const period = dataset.latestPeriod;
    const yearAgo = addMonths(period, -12);

    const build = (target: Period) => {
      const sales = dataset.saleStats.filter((row) => row.period === target);
      const rents = dataset.rentalStats.filter((row) => row.period === target);

      const medianFor = (type: PropertyType) =>
        weightedMedian(
          sales
            .filter((row) => row.propertyType === type)
            .map((row) => ({
              value: row.medianPrice,
              weight: this.seedsById.get(row.neighbourhoodId)?.stock[type] ?? 0,
            })),
        );

      const rentFor = (bedroomType: BedroomType) =>
        weightedMean(
          rents
            .filter((row) => row.bedroomType === bedroomType)
            .map((row) => ({
              value: row.averageRent,
              weight: totalStock(this.seedsById.get(row.neighbourhoodId)),
            })),
        );

      const vacancy = weightedMean(
        rents
          .filter((row) => row.bedroomType === "twoBedroom")
          .map((row) => ({
            value: row.vacancyRate,
            weight: totalStock(this.seedsById.get(row.neighbourhoodId)),
          })),
      );

      const daysOnMarket = weightedMean(
        sales.map((row) => ({
          value: row.averageDaysOnMarket,
          weight: row.salesCount,
        })),
      );

      return {
        medianCondoPrice: medianFor("condo") ?? 0,
        medianHousePrice: medianFor("house") ?? 0,
        medianPlexPrice: medianFor("plex") ?? 0,
        averageOneBedroomRent: roundTo(rentFor("oneBedroom") ?? 0, 5),
        averageTwoBedroomRent: roundTo(rentFor("twoBedroom") ?? 0, 5),
        vacancyRate: Math.round((vacancy ?? 0) * 10) / 10,
        averageDaysOnMarket: Math.round(daysOnMarket ?? 0),
        activeListings: sum(sales.map((row) => row.activeListings)),
      };
    };

    const current = build(period);
    const previous = build(yearAgo);

    this.cityOverviewCache = {
      period,
      ...current,
      changes: {
        medianCondoPrice: percentChange(current.medianCondoPrice, previous.medianCondoPrice),
        medianHousePrice: percentChange(current.medianHousePrice, previous.medianHousePrice),
        medianPlexPrice: percentChange(current.medianPlexPrice, previous.medianPlexPrice),
        averageOneBedroomRent: percentChange(
          current.averageOneBedroomRent,
          previous.averageOneBedroomRent,
        ),
        averageTwoBedroomRent: percentChange(
          current.averageTwoBedroomRent,
          previous.averageTwoBedroomRent,
        ),
        // A rate, so this is a percentage-point difference. See pointChange.
        vacancyRate: pointChange(current.vacancyRate, previous.vacancyRate),
        averageDaysOnMarket: percentChange(
          current.averageDaysOnMarket,
          previous.averageDaysOnMarket,
        ),
        activeListings: percentChange(current.activeListings, previous.activeListings),
      },
    };

    return this.cityOverviewCache;
  }

  async getComparison(slugs: string[]): Promise<ComparisonRow[]> {
    const rows = await Promise.all(
      slugs.map(async (slug) => {
        const snapshot = await this.getSnapshot(slug);
        if (!snapshot) return null;

        const condo = snapshot.sale.condo;
        const dominantStat = snapshot.sale[dominantPropertyType(this.seedsBySlug.get(slug)!)];

        const row: ComparisonRow = {
          slug: snapshot.slug,
          name: snapshot.name,
          medianCondoPrice: condo?.medianPrice ?? null,
          pricePerSqFt: condo?.averagePricePerSqFt ?? null,
          oneBedroomRent: snapshot.rent.oneBedroom.averageRent,
          twoBedroomRent: snapshot.rent.twoBedroom.averageRent,
          vacancyRate: snapshot.vacancyRate,
          averageDaysOnMarket: dominantStat?.averageDaysOnMarket ?? 0,
          priceYoyChange: dominantStat?.yearOverYearChange ?? null,
          rentYoyChange: snapshot.rent.twoBedroom.yearOverYearChange,
          condition: snapshot.condition.label,
        };
        return row;
      }),
    );

    return rows.filter((row): row is ComparisonRow => row !== null);
  }

  async listDataSources(): Promise<DataSource[]> {
    return DATA_SOURCES;
  }

  async listImportRuns(limit = 20): Promise<ImportRun[]> {
    return DEMO_IMPORT_RUNS.slice(0, limit);
  }

  async getBoundaries(): Promise<NeighbourhoodBoundary[]> {
    // No boundary dataset is bundled. The map renders its "awaiting GeoJSON" state
    // rather than drawing invented shapes.
    return [];
  }

  private resolveId(slug?: string, id?: string): string | undefined {
    if (id) return id;
    if (slug) return this.seedsBySlug.get(slug)?.id;
    return undefined;
  }
}

const PROPERTY_TYPE_NOUNS: Record<PropertyType, string> = {
  condo: "condo",
  house: "house",
  plex: "plex",
};

function toNeighbourhood(seed: NeighbourhoodSeed): Neighbourhood {
  return {
    id: seed.id,
    name: seed.name,
    slug: seed.slug,
    borough: seed.borough,
    latitude: seed.latitude,
    longitude: seed.longitude,
    profile: seed.profile,
  };
}

/** The property type holding the largest share of the neighbourhood's stock. */
function dominantPropertyType(seed: NeighbourhoodSeed): PropertyType {
  let best: PropertyType = seed.propertyTypes[0];
  let bestStock = -1;
  for (const type of seed.propertyTypes) {
    const stock = seed.stock[type] ?? 0;
    if (stock > bestStock) {
      best = type;
      bestStock = stock;
    }
  }
  return best;
}

function totalStock(seed: NeighbourhoodSeed | undefined): number {
  if (!seed) return 0;
  return PROPERTY_TYPES.reduce((total, type) => total + (seed.stock[type] ?? 0), 0);
}

function byPeriod(a: { period: Period }, b: { period: Period }): number {
  return comparePeriods(a.period, b.period);
}

function roundTo(value: number, step: number): number {
  return Math.round(value / step) * step;
}
