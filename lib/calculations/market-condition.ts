import type {
  MarketCondition,
  MarketConditionFactor,
  MarketConditionLabel,
} from "@/types";

/**
 * Market condition classification.
 *
 * The requirement this satisfies: the buyer's / balanced / seller's label must be
 * *computed*, never asserted. So this module takes four measured inputs, normalises
 * each onto a common 0–100 axis, and returns both the label and the working — the
 * UI renders the factors so a reader can disagree with the weighting rather than
 * having to trust a badge.
 *
 * 0 = deep buyer's market, 100 = deep seller's market.
 */

export interface MarketConditionInput {
  /** Active listings ÷ monthly sales. The standard liquidity measure. */
  monthsOfInventory: number;
  averageDaysOnMarket: number;
  /** Sale price as a percentage of asking price. */
  listingToSaleRatio: number;
  /** Year-over-year change in median price, as a percentage. */
  priceMomentum: number | null;
}

/**
 * Thresholds at which each factor reads as fully buyer's-favouring or fully
 * seller's-favouring. These are conventional rules of thumb from residential
 * market analysis, not measurements — they are exported so they can be tuned
 * against real Montréal data once it is connected.
 */
export const CONDITION_THRESHOLDS = {
  monthsOfInventory: { sellers: 2, buyers: 8 },
  averageDaysOnMarket: { sellers: 15, buyers: 75 },
  listingToSaleRatio: { sellers: 104, buyers: 96 },
  priceMomentum: { sellers: 10, buyers: -4 },
} as const;

/** Weights sum to 1. Inventory dominates because it leads the other three. */
export const CONDITION_WEIGHTS = {
  monthsOfInventory: 0.35,
  listingToSaleRatio: 0.3,
  daysOnMarket: 0.2,
  priceMomentum: 0.15,
} as const;

/** Map a value onto 0–100, where `sellers` is the 100 end. Handles both directions. */
function normalise(value: number, sellersEnd: number, buyersEnd: number): number {
  const span = sellersEnd - buyersEnd;
  if (span === 0) return 50;
  const raw = ((value - buyersEnd) / span) * 100;
  return Math.min(100, Math.max(0, raw));
}

export function classifyMarketCondition(input: MarketConditionInput): MarketCondition {
  const t = CONDITION_THRESHOLDS;
  const w = CONDITION_WEIGHTS;

  const factors: MarketConditionFactor[] = [
    {
      key: "monthsOfInventory",
      value: input.monthsOfInventory,
      contribution: normalise(
        input.monthsOfInventory,
        t.monthsOfInventory.sellers,
        t.monthsOfInventory.buyers,
      ),
      weight: w.monthsOfInventory,
    },
    {
      key: "listingToSaleRatio",
      value: input.listingToSaleRatio,
      contribution: normalise(
        input.listingToSaleRatio,
        t.listingToSaleRatio.sellers,
        t.listingToSaleRatio.buyers,
      ),
      weight: w.listingToSaleRatio,
    },
    {
      key: "daysOnMarket",
      value: input.averageDaysOnMarket,
      contribution: normalise(
        input.averageDaysOnMarket,
        t.averageDaysOnMarket.sellers,
        t.averageDaysOnMarket.buyers,
      ),
      weight: w.daysOnMarket,
    },
  ];

  // Momentum is optional: a neighbourhood with under a year of history has no
  // year-over-year figure, and inventing one would defeat the point. When it is
  // missing the remaining weights are rescaled instead.
  if (input.priceMomentum !== null) {
    factors.push({
      key: "priceMomentum",
      value: input.priceMomentum,
      contribution: normalise(
        input.priceMomentum,
        t.priceMomentum.sellers,
        t.priceMomentum.buyers,
      ),
      weight: w.priceMomentum,
    });
  }

  const totalWeight = factors.reduce((sum, factor) => sum + factor.weight, 0);
  const score =
    factors.reduce((sum, factor) => sum + factor.contribution * factor.weight, 0) /
    totalWeight;

  return {
    label: scoreToLabel(score),
    score: Math.round(score),
    factors,
  };
}

export function scoreToLabel(score: number): MarketConditionLabel {
  if (score >= 60) return "sellers";
  if (score <= 40) return "buyers";
  return "balanced";
}

/** Active listings ÷ monthly sales, guarded against a zero-sales month. */
export function monthsOfInventory(activeListings: number, salesCount: number): number {
  if (salesCount <= 0) return CONDITION_THRESHOLDS.monthsOfInventory.buyers;
  return Math.round((activeListings / salesCount) * 10) / 10;
}
