import type { PropertyType, BedroomType } from "@/types";

/**
 * ⚠️ DEMONSTRATION DATA — NOT REAL MARKET STATISTICS ⚠️
 *
 * This file is the single seed table the whole demo dataset is generated from.
 * The numbers are plausible for Montréal but they are *invented*: none of them
 * were sourced from CMHC, the Ville de Montréal, or any listing service. They
 * exist so the charts, filters and calculators have something coherent to work
 * on before real data is connected.
 *
 * ── Adding a neighbourhood ──────────────────────────────────────────────
 * Append one entry below. Everything else — routes, dashboards, the comparison
 * table, the map legend, the API — reads from this array, so no other file needs
 * to change.
 *
 * ── Replacing this with real data ───────────────────────────────────────
 * Nothing outside `data/demo/` imports this file. The application talks to a
 * `MarketDataRepository` (see lib/data/repository.ts); point that at PostgreSQL
 * and this seed table simply stops being read.
 */

/** Latest reporting month in the demo dataset, held fixed so output is stable. */
export const DEMO_LATEST_PERIOD = "2026-06";

/** How many months of history the generator produces. */
export const DEMO_HISTORY_MONTHS = 84;

export interface NeighbourhoodSeed {
  id: string;
  name: string;
  slug: string;
  borough: string;
  latitude: number;
  longitude: number;
  /** Neutral description of location and built form. Never a market claim. */
  profile: string;

  /** Which property types exist here in meaningful numbers. */
  propertyTypes: PropertyType[];

  /**
   * Approximate dwelling counts by type. Listing and sales volumes are derived
   * from these rather than authored separately, so the numbers stay coherent.
   */
  stock: Partial<Record<PropertyType, number>>;

  /** Median sale price in the latest period, by property type. */
  medianPrice: Partial<Record<PropertyType, number>>;

  /** Average price per square foot in the latest period, by property type. */
  pricePerSqFt: Partial<Record<PropertyType, number>>;

  /** Average monthly rent in the latest period, by unit size. */
  rent: Record<BedroomType, number>;

  /** Rental vacancy rate, percent. */
  vacancyRate: number;

  /** Average days a listing sits on market. */
  daysOnMarket: number;

  /** Active listings divided by monthly sales — the standard liquidity measure. */
  monthsOfInventory: number;

  /** Sale price as a percentage of asking price. Over 100 = selling above ask. */
  listingToSaleRatio: number;

  /** Annualised growth used to project the series backwards, as a fraction. */
  growth: {
    sale: number;
    rent: number;
  };
}

export const NEIGHBOURHOOD_SEEDS: NeighbourhoodSeed[] = [
  {
    id: "nbh-plateau-mont-royal",
    name: "Plateau-Mont-Royal",
    slug: "plateau-mont-royal",
    borough: "Le Plateau-Mont-Royal",
    latitude: 45.5233,
    longitude: -73.5829,
    profile:
      "A dense, low-rise borough east of Mount Royal, built mostly of two- and three-storey walk-up plexes on a tight street grid.",
    propertyTypes: ["condo", "house", "plex"],
    stock: { condo: 12000, house: 900, plex: 14000 },
    medianPrice: { condo: 625000, house: 1150000, plex: 1310000 },
    pricePerSqFt: { condo: 742, house: 690, plex: 545 },
    rent: { studio: 1350, oneBedroom: 1600, twoBedroom: 1950, threeBedroom: 2450 },
    vacancyRate: 1.4,
    daysOnMarket: 26,
    monthsOfInventory: 2.6,
    listingToSaleRatio: 101.4,
    growth: { sale: 0.048, rent: 0.06 },
  },
  {
    id: "nbh-rosemont-la-petite-patrie",
    name: "Rosemont–La Petite-Patrie",
    slug: "rosemont-la-petite-patrie",
    borough: "Rosemont–La Petite-Patrie",
    latitude: 45.5432,
    longitude: -73.5807,
    profile:
      "A large residential borough north-east of the Plateau, dominated by early-twentieth-century plexes with pockets of newer infill along the Metro line.",
    propertyTypes: ["condo", "house", "plex"],
    stock: { condo: 9000, house: 3500, plex: 16000 },
    medianPrice: { condo: 520000, house: 875000, plex: 1050000 },
    pricePerSqFt: { condo: 620, house: 545, plex: 460 },
    rent: { studio: 1180, oneBedroom: 1400, twoBedroom: 1700, threeBedroom: 2150 },
    vacancyRate: 1.6,
    daysOnMarket: 29,
    monthsOfInventory: 2.8,
    listingToSaleRatio: 100.8,
    growth: { sale: 0.052, rent: 0.055 },
  },
  {
    id: "nbh-ville-marie",
    name: "Ville-Marie",
    slug: "ville-marie",
    borough: "Ville-Marie",
    latitude: 45.5088,
    longitude: -73.5617,
    profile:
      "The central borough covering downtown, Old Montréal and the Quartier des Spectacles, where the residential stock is overwhelmingly high-rise condominium.",
    propertyTypes: ["condo", "house", "plex"],
    stock: { condo: 22000, house: 800, plex: 4000 },
    medianPrice: { condo: 680000, house: 1450000, plex: 1500000 },
    pricePerSqFt: { condo: 820, house: 745, plex: 620 },
    rent: { studio: 1500, oneBedroom: 1800, twoBedroom: 2250, threeBedroom: 2950 },
    vacancyRate: 2.6,
    daysOnMarket: 38,
    monthsOfInventory: 4.6,
    listingToSaleRatio: 98.4,
    growth: { sale: 0.034, rent: 0.046 },
  },
  {
    id: "nbh-griffintown",
    name: "Griffintown",
    slug: "griffintown",
    borough: "Le Sud-Ouest",
    latitude: 45.4924,
    longitude: -73.5599,
    profile:
      "A former industrial district south-west of downtown, rebuilt since the late 2000s almost entirely as mid- and high-rise condominium towers.",
    // Deliberately condo-only: the district has effectively no detached houses or
    // plexes, and the dashboards show an empty state rather than inventing numbers.
    propertyTypes: ["condo"],
    stock: { condo: 9500 },
    medianPrice: { condo: 585000 },
    pricePerSqFt: { condo: 880 },
    rent: { studio: 1600, oneBedroom: 1850, twoBedroom: 2400, threeBedroom: 3100 },
    vacancyRate: 3.4,
    daysOnMarket: 44,
    monthsOfInventory: 6.8,
    listingToSaleRatio: 96.6,
    growth: { sale: 0.021, rent: 0.038 },
  },
  {
    id: "nbh-verdun",
    name: "Verdun",
    slug: "verdun",
    borough: "Verdun",
    latitude: 45.4581,
    longitude: -73.5673,
    profile:
      "A riverside borough south-west of downtown, laid out in long blocks of duplexes and triplexes with a commercial spine along Rue Wellington.",
    propertyTypes: ["condo", "house", "plex"],
    stock: { condo: 7000, house: 2600, plex: 9000 },
    medianPrice: { condo: 495000, house: 780000, plex: 900000 },
    pricePerSqFt: { condo: 600, house: 520, plex: 440 },
    rent: { studio: 1150, oneBedroom: 1350, twoBedroom: 1650, threeBedroom: 2050 },
    vacancyRate: 1.8,
    daysOnMarket: 27,
    monthsOfInventory: 2.5,
    listingToSaleRatio: 101.9,
    growth: { sale: 0.056, rent: 0.062 },
  },
  {
    id: "nbh-saint-henri",
    name: "Saint-Henri",
    slug: "saint-henri",
    borough: "Le Sud-Ouest",
    latitude: 45.4767,
    longitude: -73.5859,
    profile:
      "A canal-side district in the Sud-Ouest, mixing nineteenth-century workers' housing with converted industrial buildings along the Lachine Canal.",
    propertyTypes: ["condo", "house", "plex"],
    stock: { condo: 6000, house: 1200, plex: 5000 },
    medianPrice: { condo: 505000, house: 820000, plex: 950000 },
    pricePerSqFt: { condo: 630, house: 540, plex: 465 },
    rent: { studio: 1200, oneBedroom: 1420, twoBedroom: 1750, threeBedroom: 2200 },
    vacancyRate: 2.0,
    daysOnMarket: 31,
    monthsOfInventory: 3.2,
    listingToSaleRatio: 100.1,
    growth: { sale: 0.05, rent: 0.058 },
  },
  {
    id: "nbh-ahuntsic",
    name: "Ahuntsic",
    slug: "ahuntsic",
    borough: "Ahuntsic-Cartierville",
    latitude: 45.5539,
    longitude: -73.6595,
    profile:
      "A northern residential district along the Rivière des Prairies, with wide streets, post-war detached housing and mid-century apartment blocks.",
    propertyTypes: ["condo", "house", "plex"],
    stock: { condo: 6500, house: 6000, plex: 11000 },
    medianPrice: { condo: 425000, house: 795000, plex: 880000 },
    pricePerSqFt: { condo: 520, house: 455, plex: 400 },
    rent: { studio: 1000, oneBedroom: 1200, twoBedroom: 1450, threeBedroom: 1800 },
    vacancyRate: 1.3,
    daysOnMarket: 33,
    monthsOfInventory: 3.4,
    listingToSaleRatio: 99.6,
    growth: { sale: 0.044, rent: 0.05 },
  },
  {
    id: "nbh-villeray",
    name: "Villeray",
    slug: "villeray",
    borough: "Villeray–Saint-Michel–Parc-Extension",
    latitude: 45.5399,
    longitude: -73.6216,
    profile:
      "A compact residential district north of Little Italy, built almost entirely of plexes around Parc Jarry and Rue Jean-Talon.",
    propertyTypes: ["condo", "house", "plex"],
    stock: { condo: 5500, house: 2200, plex: 12000 },
    medianPrice: { condo: 480000, house: 810000, plex: 985000 },
    pricePerSqFt: { condo: 590, house: 520, plex: 450 },
    rent: { studio: 1120, oneBedroom: 1330, twoBedroom: 1620, threeBedroom: 2050 },
    vacancyRate: 1.2,
    daysOnMarket: 25,
    monthsOfInventory: 2.1,
    listingToSaleRatio: 102.6,
    growth: { sale: 0.054, rent: 0.064 },
  },
  {
    id: "nbh-cote-des-neiges",
    name: "Côte-des-Neiges",
    slug: "cote-des-neiges",
    borough: "Côte-des-Neiges–Notre-Dame-de-Grâce",
    latitude: 45.4948,
    longitude: -73.6229,
    profile:
      "A dense, apartment-heavy district on the north-west slope of Mount Royal, anchored by the Université de Montréal and two major hospitals.",
    propertyTypes: ["condo", "house", "plex"],
    stock: { condo: 12000, house: 3000, plex: 9000 },
    medianPrice: { condo: 400000, house: 950000, plex: 1020000 },
    pricePerSqFt: { condo: 505, house: 500, plex: 430 },
    rent: { studio: 1050, oneBedroom: 1250, twoBedroom: 1500, threeBedroom: 1900 },
    vacancyRate: 2.2,
    daysOnMarket: 36,
    monthsOfInventory: 4.1,
    listingToSaleRatio: 98.9,
    growth: { sale: 0.038, rent: 0.052 },
  },
  {
    id: "nbh-outremont",
    name: "Outremont",
    slug: "outremont",
    borough: "Outremont",
    latitude: 45.5188,
    longitude: -73.6103,
    profile:
      "A small borough on the north-west flank of Mount Royal, characterised by large detached and semi-detached houses on tree-lined streets.",
    propertyTypes: ["condo", "house", "plex"],
    stock: { condo: 3000, house: 1800, plex: 2500 },
    medianPrice: { condo: 720000, house: 1650000, plex: 1750000 },
    pricePerSqFt: { condo: 790, house: 720, plex: 610 },
    rent: { studio: 1400, oneBedroom: 1700, twoBedroom: 2100, threeBedroom: 2800 },
    vacancyRate: 1.5,
    daysOnMarket: 40,
    monthsOfInventory: 4.4,
    listingToSaleRatio: 98.2,
    growth: { sale: 0.036, rent: 0.044 },
  },
  {
    id: "nbh-westmount",
    name: "Westmount",
    slug: "westmount",
    borough: "Westmount (linked city)",
    latitude: 45.4835,
    longitude: -73.5978,
    profile:
      "An independent city enclaved within the island, rising up the south-west slope of Mount Royal, with a housing stock of large detached houses and low-rise apartments.",
    propertyTypes: ["condo", "house", "plex"],
    stock: { condo: 2800, house: 3200, plex: 900 },
    medianPrice: { condo: 850000, house: 2250000, plex: 2100000 },
    pricePerSqFt: { condo: 880, house: 810, plex: 690 },
    rent: { studio: 1550, oneBedroom: 1900, twoBedroom: 2400, threeBedroom: 3300 },
    vacancyRate: 1.7,
    daysOnMarket: 46,
    monthsOfInventory: 5.5,
    listingToSaleRatio: 97.1,
    growth: { sale: 0.03, rent: 0.04 },
  },
  {
    id: "nbh-hochelaga-maisonneuve",
    name: "Hochelaga-Maisonneuve",
    slug: "hochelaga-maisonneuve",
    borough: "Mercier–Hochelaga-Maisonneuve",
    latitude: 45.5439,
    longitude: -73.5411,
    profile:
      "An east-end district of former factory housing on a regular grid, running from the Olympic Park down to the port.",
    propertyTypes: ["condo", "house", "plex"],
    stock: { condo: 5000, house: 1500, plex: 12000 },
    medianPrice: { condo: 385000, house: 650000, plex: 760000 },
    pricePerSqFt: { condo: 480, house: 430, plex: 375 },
    rent: { studio: 950, oneBedroom: 1130, twoBedroom: 1380, threeBedroom: 1720 },
    vacancyRate: 1.9,
    daysOnMarket: 28,
    monthsOfInventory: 2.4,
    listingToSaleRatio: 102.1,
    growth: { sale: 0.062, rent: 0.07 },
  },
];
