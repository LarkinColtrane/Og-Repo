import type { MarketConditionLabel } from "@/types";
import { formatDays, formatNumber, formatPercent, formatSignedPercent } from "./format";

/**
 * Generates the one-paragraph market summary shown at the top of each dashboard.
 *
 * Why generate it instead of writing it: hand-authored copy like "strong rental
 * demand, limited vacancy" is a claim that stops being true the moment the data
 * moves, and nothing in the system would notice. Every clause below is chosen by a
 * threshold on a measured value and quotes that value, so the prose cannot drift
 * away from the numbers underneath it.
 */

export interface MarketSummaryInput {
  neighbourhoodName: string;
  /** Year-over-year change in the median price of the dominant property type. */
  priceChange: number | null;
  /** The property type that change refers to. */
  priceChangeType: string;
  averageDaysOnMarket: number;
  monthsOfInventory: number;
  vacancyRate: number;
  /** City-wide vacancy rate, for the comparison clause. Optional. */
  cityVacancyRate?: number;
  rentChange: number | null;
  condition: MarketConditionLabel;
}

const CONDITION_PHRASES: Record<MarketConditionLabel, string> = {
  buyers: "a buyer's market",
  balanced: "a balanced market",
  sellers: "a seller's market",
};

function priceClause(change: number | null, type: string): string {
  if (change === null) {
    return `There is not yet a full year of ${type} price history on record`;
  }
  if (change >= 6) {
    return `Median ${type} prices are ${formatSignedPercent(change)} year over year`;
  }
  if (change >= 2) {
    return `Median ${type} prices are up ${formatPercent(change)} year over year`;
  }
  if (change > -1) {
    return `Median ${type} prices are close to flat at ${formatSignedPercent(change)} year over year`;
  }
  return `Median ${type} prices are down ${formatPercent(Math.abs(change))} year over year`;
}

function paceClause(daysOnMarket: number, monthsOfInventory: number): string {
  return `listings are taking ${formatDays(daysOnMarket)} to sell, against ${formatNumber(monthsOfInventory, 1)} months of inventory`;
}

function vacancyClause(vacancyRate: number, cityVacancyRate?: number): string {
  const base = `Rental vacancy sits at ${formatPercent(vacancyRate)}`;
  if (cityVacancyRate === undefined) return `${base}.`;

  const difference = vacancyRate - cityVacancyRate;
  if (Math.abs(difference) < 0.2) {
    return `${base}, in line with the Montréal-wide ${formatPercent(cityVacancyRate)}.`;
  }
  const direction = difference < 0 ? "below" : "above";
  return `${base}, ${direction} the Montréal-wide ${formatPercent(cityVacancyRate)}.`;
}

function rentClause(change: number | null): string {
  if (change === null) return "";
  if (change >= 5) return ` Average rents have moved ${formatSignedPercent(change)} over the same period.`;
  if (change > 0) return ` Average rents are up ${formatPercent(change)} over the same period.`;
  return ` Average rents are ${formatSignedPercent(change)} over the same period.`;
}

export function buildMarketSummary(input: MarketSummaryInput): string {
  const sentences = [
    `${priceClause(input.priceChange, input.priceChangeType)} and ${paceClause(input.averageDaysOnMarket, input.monthsOfInventory)}.`,
    `${vacancyClause(input.vacancyRate, input.cityVacancyRate)}${rentClause(input.rentChange)}`,
    `Weighing inventory, selling pace, price-to-ask and momentum together, ${input.neighbourhoodName} currently scores as ${CONDITION_PHRASES[input.condition]}.`,
  ];

  return sentences.join(" ");
}

/**
 * Seller-facing reading of the same measures. Deliberately framed as what the
 * indicators *suggest*, never as a prediction of sale price — no output of this
 * function should be able to be read as "you will sell for X".
 */
export function buildSellerGuidance(input: {
  condition: MarketConditionLabel;
  averageDaysOnMarket: number;
  listingToSaleRatio: number;
  monthsOfInventory: number;
}): string[] {
  const notes: string[] = [];

  if (input.condition === "sellers") {
    notes.push(
      `With ${formatNumber(input.monthsOfInventory, 1)} months of inventory, buyers here have relatively few alternatives to choose from. Historically that is the condition in which well-prepared listings move quickly — it is not a guarantee about any particular property.`,
    );
  } else if (input.condition === "buyers") {
    notes.push(
      `At ${formatNumber(input.monthsOfInventory, 1)} months of inventory, buyers have a wide selection. Competing on presentation and pricing tends to matter more in this condition than in a tight market.`,
    );
  } else {
    notes.push(
      `Inventory of ${formatNumber(input.monthsOfInventory, 1)} months puts supply and demand roughly in balance, which usually means neither side has a structural advantage.`,
    );
  }

  if (input.listingToSaleRatio >= 100) {
    notes.push(
      `Recent sales have closed at about ${formatPercent(input.listingToSaleRatio)} of asking on average, so asking prices in this area have generally been met or exceeded. Averages hide a wide spread between individual properties.`,
    );
  } else {
    notes.push(
      `Recent sales have closed at about ${formatPercent(input.listingToSaleRatio)} of asking on average, so there has typically been some negotiation between list and sale price.`,
    );
  }

  notes.push(
    `Average time on market is ${formatDays(input.averageDaysOnMarket)}. Use it to plan timing — a property's own condition, layout and pricing drive far more of the outcome than the neighbourhood average does.`,
  );

  return notes;
}
