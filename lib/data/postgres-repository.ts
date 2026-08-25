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
import { addMonths } from "@/lib/periods";
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
import { RepositoryNotImplementedError } from "./repository";

/**
 * PostgreSQL / Supabase implementation.
 *
 * ── Status ──────────────────────────────────────────────────────────────
 * This class is **not wired up**. There is no database in the repository and no
 * driver in package.json, by design: the point of the exercise is that swapping
 * data sources is a contained change, and you can read exactly how contained it is
 * before committing to any of it.
 *
 * ── How to turn it on ───────────────────────────────────────────────────
 *  1. `npm install pg` (or `@supabase/supabase-js`).
 *  2. Apply `docs/sql/001_initial_schema.sql` to your database.
 *  3. Write a `SqlExecutor` — about ten lines around a connection pool; there is a
 *     worked example in docs/DATA_PIPELINE.md.
 *  4. Set `DATABASE_URL` in `.env.local`. `lib/data/index.ts` picks the Postgres
 *     repository over the demo one automatically once it is set.
 *
 * Nothing else in the application changes. Every page, route and component talks
 * to `MarketDataRepository`, not to this class.
 *
 * ── A note on the derived views ─────────────────────────────────────────
 * `getSnapshot`, `getCityOverview` and `getComparison` are composed from the
 * primitive reads and the shared calculation modules — the same modules the demo
 * repository uses. Market condition, year-over-year change and the summary prose
 * are therefore computed identically no matter where the rows came from, which is
 * what stops the two implementations drifting apart.
 */

/**
 * The only thing this repository needs from a driver: run a parameterised query,
 * get rows back. Keeping it this narrow means `pg`, `postgres.js` and Supabase all
 * satisfy it, and none of them leak into the rest of the codebase.
 */
export type SqlExecutor = <TRow = Record<string, unknown>>(
  sql: string,
  params?: unknown[],
) => Promise<TRow[]>;

interface NeighbourhoodRow {
  id: string;
  name: string;
  slug: string;
  borough: string;
  latitude: string | number;
  longitude: string | number;
  profile: string;
  dwelling_stock: Record<string, number> | null;
}

export class PostgresMarketDataRepository implements MarketDataRepository {
  readonly name = "PostgreSQL";
  readonly dataQuality = "live" as const;

  constructor(private readonly query: SqlExecutor) {}

  async getLatestPeriod(): Promise<Period> {
    const rows = await this.query<{ period: string }>(
      `SELECT to_char(max(period), 'YYYY-MM') AS period FROM sale_market_stats`,
    );
    const period = rows[0]?.period;
    if (!period) throw new Error("No sale statistics on record.");
    return period;
  }

  async listNeighbourhoods(): Promise<Neighbourhood[]> {
    const rows = await this.query<NeighbourhoodRow>(
      `SELECT id, name, slug, borough, latitude, longitude, profile, dwelling_stock
         FROM neighbourhoods
        ORDER BY name`,
    );
    return rows.map(toNeighbourhood);
  }

  async getNeighbourhood(slug: string): Promise<Neighbourhood | null> {
    const rows = await this.query<NeighbourhoodRow>(
      `SELECT id, name, slug, borough, latitude, longitude, profile, dwelling_stock
         FROM neighbourhoods
        WHERE slug = $1`,
      [slug],
    );
    return rows[0] ? toNeighbourhood(rows[0]) : null;
  }

  async getSaleStats(filter: SaleStatsFilter): Promise<SaleMarketStat[]> {
    // Conditions are built as `($n IS NULL OR column = $n)` so one prepared
    // statement serves every filter combination — no string concatenation, no
    // injection surface.
    const rows = await this.query<Record<string, unknown>>(
      `SELECT s.neighbourhood_id,
              to_char(s.period, 'YYYY-MM')      AS period,
              s.property_type,
              s.median_price,
              s.average_price_per_sqft,
              s.active_listings,
              s.new_listings,
              s.sales_count,
              s.average_days_on_market,
              s.yoy_change,
              s.listing_to_sale_ratio,
              s.data_source_id
         FROM sale_market_stats s
         JOIN neighbourhoods n ON n.id = s.neighbourhood_id
        WHERE ($1::text IS NULL OR n.slug = $1)
          AND ($2::text IS NULL OR s.neighbourhood_id = $2)
          AND ($3::text IS NULL OR s.property_type = $3)
          AND ($4::text IS NULL OR s.period >= to_date($4, 'YYYY-MM'))
          AND ($5::text IS NULL OR s.period <= to_date($5, 'YYYY-MM'))
        ORDER BY s.period`,
      [
        filter.neighbourhoodSlug ?? null,
        filter.neighbourhoodId ?? null,
        filter.propertyType ?? null,
        filter.from ?? null,
        filter.to ?? null,
      ],
    );
    return rows.map(toSaleStat);
  }

  async getRentalStats(filter: RentalStatsFilter): Promise<RentalMarketStat[]> {
    const rows = await this.query<Record<string, unknown>>(
      `SELECT r.neighbourhood_id,
              to_char(r.period, 'YYYY-MM') AS period,
              r.bedroom_type,
              r.average_rent,
              r.median_rent,
              r.vacancy_rate,
              r.yoy_change,
              r.data_source_id
         FROM rental_market_stats r
         JOIN neighbourhoods n ON n.id = r.neighbourhood_id
        WHERE ($1::text IS NULL OR n.slug = $1)
          AND ($2::text IS NULL OR r.neighbourhood_id = $2)
          AND ($3::text IS NULL OR r.bedroom_type = $3)
          AND ($4::text IS NULL OR r.period >= to_date($4, 'YYYY-MM'))
          AND ($5::text IS NULL OR r.period <= to_date($5, 'YYYY-MM'))
        ORDER BY r.period`,
      [
        filter.neighbourhoodSlug ?? null,
        filter.neighbourhoodId ?? null,
        filter.bedroomType ?? null,
        filter.from ?? null,
        filter.to ?? null,
      ],
    );
    return rows.map(toRentalStat);
  }

  async getSnapshot(slug: string): Promise<NeighbourhoodSnapshot | null> {
    const neighbourhood = await this.getNeighbourhood(slug);
    if (!neighbourhood) return null;

    const period = await this.getLatestPeriod();
    const [sales, rents, cityOverview] = await Promise.all([
      this.getSaleStats({ neighbourhoodSlug: slug, from: period, to: period }),
      this.getRentalStats({ neighbourhoodSlug: slug, from: period, to: period }),
      this.getCityOverview(),
    ]);

    const sale: Partial<Record<PropertyType, SaleMarketStat>> = {};
    for (const row of sales) sale[row.propertyType] = row;

    const rent = {} as Record<BedroomType, RentalMarketStat>;
    for (const row of rents) rent[row.bedroomType] = row;

    // Whichever type has the most listings stands in for "the local market".
    const lead = sales.reduce<SaleMarketStat | null>(
      (best, row) => (!best || row.salesCount > best.salesCount ? row : best),
      null,
    );
    if (!lead) return null;

    const moi = monthsOfInventory(lead.activeListings, lead.salesCount);
    const condition = classifyMarketCondition({
      monthsOfInventory: moi,
      averageDaysOnMarket: lead.averageDaysOnMarket,
      listingToSaleRatio: lead.listingToSaleRatio,
      priceMomentum: lead.yearOverYearChange,
    });

    const vacancyRate = rent.twoBedroom?.vacancyRate ?? 0;

    return {
      neighbourhoodId: neighbourhood.id,
      slug: neighbourhood.slug,
      name: neighbourhood.name,
      period,
      sale,
      rent,
      availablePropertyTypes: PROPERTY_TYPES.filter((type) => sale[type] !== undefined),
      vacancyRate,
      condition,
      summary: buildMarketSummary({
        neighbourhoodName: neighbourhood.name,
        priceChange: lead.yearOverYearChange,
        priceChangeType: lead.propertyType,
        averageDaysOnMarket: lead.averageDaysOnMarket,
        monthsOfInventory: moi,
        vacancyRate,
        cityVacancyRate: cityOverview.vacancyRate,
        rentChange: rent.twoBedroom?.yearOverYearChange ?? null,
        condition: condition.label,
      }),
    };
  }

  async getCityOverview(): Promise<CityOverview> {
    const period = await this.getLatestPeriod();
    const yearAgo = addMonths(period, -12);

    const neighbourhoods = await this.query<NeighbourhoodRow>(
      `SELECT id, name, slug, borough, latitude, longitude, profile, dwelling_stock
         FROM neighbourhoods`,
    );
    const stockById = new Map(
      neighbourhoods.map((row) => [row.id, row.dwelling_stock ?? {}]),
    );

    const build = async (target: Period) => {
      const [sales, rents] = await Promise.all([
        this.getSaleStats({ from: target, to: target }),
        this.getRentalStats({ from: target, to: target }),
      ]);

      const medianFor = (type: PropertyType) =>
        weightedMedian(
          sales
            .filter((row) => row.propertyType === type)
            .map((row) => ({
              value: row.medianPrice,
              weight: stockById.get(row.neighbourhoodId)?.[type] ?? 0,
            })),
        );

      const totalStockFor = (id: string) =>
        Object.values(stockById.get(id) ?? {}).reduce((a, b) => a + b, 0);

      const rentFor = (bedroomType: BedroomType) =>
        weightedMean(
          rents
            .filter((row) => row.bedroomType === bedroomType)
            .map((row) => ({
              value: row.averageRent,
              weight: totalStockFor(row.neighbourhoodId),
            })),
        );

      return {
        medianCondoPrice: medianFor("condo") ?? 0,
        medianHousePrice: medianFor("house") ?? 0,
        medianPlexPrice: medianFor("plex") ?? 0,
        averageOneBedroomRent: Math.round(rentFor("oneBedroom") ?? 0),
        averageTwoBedroomRent: Math.round(rentFor("twoBedroom") ?? 0),
        vacancyRate:
          Math.round(
            (weightedMean(
              rents
                .filter((row) => row.bedroomType === "twoBedroom")
                .map((row) => ({
                  value: row.vacancyRate,
                  weight: totalStockFor(row.neighbourhoodId),
                })),
            ) ?? 0) * 10,
          ) / 10,
        averageDaysOnMarket: Math.round(
          weightedMean(
            sales.map((row) => ({
              value: row.averageDaysOnMarket,
              weight: row.salesCount,
            })),
          ) ?? 0,
        ),
        activeListings: sum(sales.map((row) => row.activeListings)),
      };
    };

    const [current, previous] = await Promise.all([build(period), build(yearAgo)]);

    return {
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
  }

  async getComparison(slugs: string[]): Promise<ComparisonRow[]> {
    const snapshots = await Promise.all(slugs.map((slug) => this.getSnapshot(slug)));
    return snapshots
      .filter((snapshot): snapshot is NeighbourhoodSnapshot => snapshot !== null)
      .map((snapshot) => {
        const lead =
          snapshot.sale[snapshot.availablePropertyTypes[0]] ?? snapshot.sale.condo;
        return {
          slug: snapshot.slug,
          name: snapshot.name,
          medianCondoPrice: snapshot.sale.condo?.medianPrice ?? null,
          pricePerSqFt: snapshot.sale.condo?.averagePricePerSqFt ?? null,
          oneBedroomRent: snapshot.rent.oneBedroom.averageRent,
          twoBedroomRent: snapshot.rent.twoBedroom.averageRent,
          vacancyRate: snapshot.vacancyRate,
          averageDaysOnMarket: lead?.averageDaysOnMarket ?? 0,
          priceYoyChange: lead?.yearOverYearChange ?? null,
          rentYoyChange: snapshot.rent.twoBedroom.yearOverYearChange,
          condition: snapshot.condition.label,
        };
      });
  }

  async listDataSources(): Promise<DataSource[]> {
    const rows = await this.query<Record<string, unknown>>(
      `SELECT id, name, source_type, url, last_updated, status, licence, description,
              refresh_cadence
         FROM data_sources
        ORDER BY name`,
    );
    return rows.map((row) => ({
      id: String(row.id),
      name: String(row.name),
      sourceType: row.source_type as DataSource["sourceType"],
      url: String(row.url ?? ""),
      lastUpdated: row.last_updated ? new Date(String(row.last_updated)).toISOString() : null,
      status: row.status as DataSource["status"],
      licence: row.licence ? String(row.licence) : null,
      description: String(row.description ?? ""),
      refreshCadence: row.refresh_cadence as DataSource["refreshCadence"],
    }));
  }

  async listImportRuns(limit = 20): Promise<ImportRun[]> {
    const rows = await this.query<Record<string, unknown>>(
      `SELECT id, data_source_id, started_at, completed_at, status, records_imported,
              error_message, triggered_by
         FROM import_runs
        ORDER BY started_at DESC
        LIMIT $1`,
      [limit],
    );
    return rows.map((row) => ({
      id: String(row.id),
      dataSourceId: String(row.data_source_id),
      startedAt: new Date(String(row.started_at)).toISOString(),
      completedAt: row.completed_at ? new Date(String(row.completed_at)).toISOString() : null,
      status: row.status as ImportRun["status"],
      recordsImported: Number(row.records_imported ?? 0),
      errorMessage: row.error_message ? String(row.error_message) : null,
      triggeredBy: row.triggered_by as ImportRun["triggeredBy"],
    }));
  }

  async getBoundaries(): Promise<NeighbourhoodBoundary[]> {
    // Boundaries live in a `neighbourhood_boundaries` table with a `geometry`
    // column, loaded from the Ville de Montréal open-data GeoJSON. Until that
    // import exists there is nothing to return, and inventing outlines is not an
    // option — see the market map component.
    throw new RepositoryNotImplementedError("getBoundaries");
  }
}

function toNeighbourhood(row: NeighbourhoodRow): Neighbourhood {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    borough: row.borough,
    latitude: Number(row.latitude),
    longitude: Number(row.longitude),
    profile: row.profile,
  };
}

function toSaleStat(row: Record<string, unknown>): SaleMarketStat {
  return {
    neighbourhoodId: String(row.neighbourhood_id),
    period: String(row.period),
    propertyType: row.property_type as PropertyType,
    medianPrice: Number(row.median_price),
    averagePricePerSqFt: Number(row.average_price_per_sqft),
    activeListings: Number(row.active_listings),
    newListings: Number(row.new_listings),
    salesCount: Number(row.sales_count),
    averageDaysOnMarket: Number(row.average_days_on_market),
    yearOverYearChange: row.yoy_change === null ? null : Number(row.yoy_change),
    listingToSaleRatio: Number(row.listing_to_sale_ratio),
    dataSourceId: String(row.data_source_id),
  };
}

function toRentalStat(row: Record<string, unknown>): RentalMarketStat {
  return {
    neighbourhoodId: String(row.neighbourhood_id),
    period: String(row.period),
    bedroomType: row.bedroom_type as BedroomType,
    averageRent: Number(row.average_rent),
    medianRent: Number(row.median_rent),
    vacancyRate: Number(row.vacancy_rate),
    yearOverYearChange: row.yoy_change === null ? null : Number(row.yoy_change),
    dataSourceId: String(row.data_source_id),
  };
}
