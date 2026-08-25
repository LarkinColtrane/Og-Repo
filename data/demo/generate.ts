import type {
  BedroomType,
  PropertyType,
  Period,
  RentalMarketStat,
  SaleMarketStat,
} from "@/types";
import { BEDROOM_TYPES } from "@/types";
import { parsePeriod, periodSeries } from "@/lib/periods";
import {
  DEMO_HISTORY_MONTHS,
  DEMO_LATEST_PERIOD,
  NEIGHBOURHOOD_SEEDS,
  type NeighbourhoodSeed,
} from "./neighbourhood-profiles";
import { DEMO_SALE_SOURCE_ID, DEMO_RENT_SOURCE_ID } from "./sources";

/**
 * ⚠️ DEMONSTRATION DATA GENERATOR — produces synthetic statistics ⚠️
 *
 * Builds several years of monthly history from the seed table so the charts have
 * something real to plot. Three properties make the output usable:
 *
 *  1. **Deterministic.** A seeded PRNG means the same input always yields the same
 *     series, so the server and the browser never disagree and nothing flickers
 *     between renders.
 *  2. **Internally consistent.** Listing and sales volumes are derived from the
 *     dwelling stock; price per square foot tracks median price; year-over-year
 *     change is measured off the generated series rather than authored. A number
 *     the UI shows as "derived" really is derived.
 *  3. **Shaped like real data.** Montréal's resale market has a pronounced spring
 *     peak and a January trough; days-on-market moves inversely. Flat synthetic
 *     lines would teach the wrong lesson about what housing data looks like.
 *
 * None of this is a forecast or a measurement. It is scaffolding.
 */

/** Small, fast, seedable PRNG. Same seed → same sequence, on any platform. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Stable 32-bit hash so each series gets its own reproducible noise stream. */
function hashString(value: string): number {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/**
 * Seasonal multipliers by calendar month (index 0 = January), reflecting the
 * shape of a Canadian resale market: a spring surge and a deep winter trough.
 */
const SALES_SEASONALITY = [
  0.62, 0.68, 0.95, 1.24, 1.38, 1.28, 1.1, 1.0, 1.02, 1.05, 0.88, 0.7,
];
const NEW_LISTINGS_SEASONALITY = [
  0.66, 0.8, 1.12, 1.32, 1.3, 1.15, 1.02, 0.95, 1.08, 1.04, 0.82, 0.62,
];
const ACTIVE_LISTINGS_SEASONALITY = [
  0.74, 0.78, 0.92, 1.12, 1.26, 1.28, 1.24, 1.16, 1.08, 1.0, 0.86, 0.74,
];
const DAYS_ON_MARKET_SEASONALITY = [
  1.18, 1.2, 1.1, 0.95, 0.88, 0.86, 0.92, 0.98, 1.0, 1.04, 1.1, 1.16,
];

/** Baseline share of the dwelling stock that trades in an average month. */
const MONTHLY_TURNOVER_RATE = 0.0035;
/** New listings run above sales over a full year; the surplus becomes inventory. */
const NEW_LISTINGS_TO_SALES = 1.22;

function roundTo(value: number, step: number): number {
  return Math.round(value / step) * step;
}

/**
 * A slow multi-year wave layered on top of the constant growth rate, so prices
 * accelerate and cool the way real markets do instead of climbing a clean ramp.
 */
function cycle(monthsBack: number, phase: number, amplitude: number): number {
  return 1 + amplitude * Math.sin((2 * Math.PI * monthsBack) / 46 + phase);
}

function generateSaleSeries(
  seed: NeighbourhoodSeed,
  propertyType: PropertyType,
  periods: Period[],
): SaleMarketStat[] {
  const basePrice = seed.medianPrice[propertyType];
  const basePsf = seed.pricePerSqFt[propertyType];
  const stock = seed.stock[propertyType];
  if (basePrice === undefined || basePsf === undefined || stock === undefined) {
    return [];
  }

  const random = mulberry32(hashString(`${seed.id}:${propertyType}:sale`));
  const phase = (hashString(`${seed.id}:${propertyType}`) % 1000) / 1000 * Math.PI * 2;
  const latestIndex = periods.length - 1;

  const rows: SaleMarketStat[] = periods.map((period, index) => {
    const monthsBack = latestIndex - index;
    const { month } = parsePeriod(period);
    const monthIndex = month - 1;

    // Project backwards from today's seed value along the growth rate.
    const trend = Math.pow(1 + seed.growth.sale, -monthsBack / 12);
    const wave = cycle(monthsBack, phase, 0.018);
    const priceSeason = 1 + 0.006 * Math.sin((2 * Math.PI * (monthIndex - 2)) / 12);
    const priceNoise = 1 + (random() - 0.5) * 0.016;

    const medianPrice = roundTo(basePrice * trend * wave * priceSeason * priceNoise, 500);

    // Price per square foot tracks price, with a little independent drift so the
    // two series are correlated rather than identical.
    const psfNoise = 1 + (random() - 0.5) * 0.014;
    const averagePricePerSqFt = Math.round((medianPrice / basePrice) * basePsf * psfNoise);

    const salesBase = stock * MONTHLY_TURNOVER_RATE;
    const salesCount = Math.max(
      1,
      Math.round(
        salesBase * SALES_SEASONALITY[monthIndex] * (1 + (random() - 0.5) * 0.14),
      ),
    );

    const newListings = Math.max(
      1,
      Math.round(
        salesBase *
          NEW_LISTINGS_TO_SALES *
          NEW_LISTINGS_SEASONALITY[monthIndex] *
          (1 + (random() - 0.5) * 0.12),
      ),
    );

    // Inventory is anchored to the neighbourhood's typical months-of-inventory,
    // then moved seasonally — so the *computed* MOI swings with the calendar the
    // way it does in practice.
    const activeListings = Math.max(
      1,
      Math.round(
        salesBase *
          seed.monthsOfInventory *
          ACTIVE_LISTINGS_SEASONALITY[monthIndex] *
          (1 + (random() - 0.5) * 0.1),
      ),
    );

    const averageDaysOnMarket = Math.max(
      5,
      Math.round(
        seed.daysOnMarket *
          DAYS_ON_MARKET_SEASONALITY[monthIndex] *
          (1 + (random() - 0.5) * 0.12),
      ),
    );

    const ratioSeason = 0.9 * Math.sin((2 * Math.PI * (monthIndex - 3)) / 12);
    const listingToSaleRatio =
      Math.round((seed.listingToSaleRatio + ratioSeason + (random() - 0.5) * 0.5) * 10) /
      10;

    return {
      neighbourhoodId: seed.id,
      period,
      propertyType,
      medianPrice,
      averagePricePerSqFt,
      activeListings,
      newListings,
      salesCount,
      averageDaysOnMarket,
      yearOverYearChange: null,
      listingToSaleRatio,
      dataSourceId: DEMO_SALE_SOURCE_ID,
    };
  });

  return attachYearOverYear(rows, (row) => row.medianPrice);
}

function generateRentalSeries(
  seed: NeighbourhoodSeed,
  bedroomType: BedroomType,
  periods: Period[],
): RentalMarketStat[] {
  const baseRent = seed.rent[bedroomType];
  const random = mulberry32(hashString(`${seed.id}:${bedroomType}:rent`));
  const phase = (hashString(`${seed.id}:${bedroomType}`) % 1000) / 1000 * Math.PI * 2;
  const latestIndex = periods.length - 1;

  // Median sits a little below the mean: the upper tail of asking rents is longer
  // than the lower one. The offset is fixed per unit size, not random.
  const medianOffset: Record<BedroomType, number> = {
    studio: 0.975,
    oneBedroom: 0.968,
    twoBedroom: 0.962,
    threeBedroom: 0.955,
  };

  const rows: RentalMarketStat[] = periods.map((period, index) => {
    const monthsBack = latestIndex - index;

    // Rents are sticky — leases turn over slowly, so month-to-month noise is small.
    const trend = Math.pow(1 + seed.growth.rent, -monthsBack / 12);
    const wave = cycle(monthsBack, phase, 0.01);
    const noise = 1 + (random() - 0.5) * 0.006;

    const averageRent = roundTo(baseRent * trend * wave * noise, 5);
    const medianRent = roundTo(averageRent * medianOffset[bedroomType], 5);

    // Vacancy moves on a slower cycle than rent and is floored — a rental market
    // never reaches zero vacancy even when it is extremely tight.
    const vacancyWave = 1 + 0.28 * Math.sin((2 * Math.PI * monthsBack) / 38 + phase);
    const vacancyRate =
      Math.round(
        Math.max(0.2, seed.vacancyRate * vacancyWave * (1 + (random() - 0.5) * 0.08)) * 10,
      ) / 10;

    return {
      neighbourhoodId: seed.id,
      period,
      bedroomType,
      averageRent,
      medianRent,
      vacancyRate,
      yearOverYearChange: null,
      dataSourceId: DEMO_RENT_SOURCE_ID,
    };
  });

  return attachYearOverYear(rows, (row) => row.averageRent);
}

/**
 * Fill in `yearOverYearChange` by comparing each row with the same month a year
 * earlier. Rows without a comparison month keep `null` rather than a guess.
 */
function attachYearOverYear<T extends { yearOverYearChange: number | null }>(
  rows: T[],
  getValue: (row: T) => number,
): T[] {
  return rows.map((row, index) => {
    if (index < 12) return row;
    const previous = getValue(rows[index - 12]);
    if (!previous) return row;
    const change = ((getValue(row) - previous) / previous) * 100;
    return { ...row, yearOverYearChange: Math.round(change * 10) / 10 };
  });
}

export interface DemoDataset {
  latestPeriod: Period;
  periods: Period[];
  saleStats: SaleMarketStat[];
  rentalStats: RentalMarketStat[];
}

/**
 * Build the full dataset. Called once per process and cached — see `dataset.ts`.
 */
export function generateDemoDataset(): DemoDataset {
  const periods = periodSeries(DEMO_LATEST_PERIOD, DEMO_HISTORY_MONTHS);
  const saleStats: SaleMarketStat[] = [];
  const rentalStats: RentalMarketStat[] = [];

  for (const seed of NEIGHBOURHOOD_SEEDS) {
    for (const propertyType of seed.propertyTypes) {
      saleStats.push(...generateSaleSeries(seed, propertyType, periods));
    }
    for (const bedroomType of BEDROOM_TYPES) {
      rentalStats.push(...generateRentalSeries(seed, bedroomType, periods));
    }
  }

  return {
    latestPeriod: DEMO_LATEST_PERIOD,
    periods,
    saleStats,
    rentalStats,
  };
}
