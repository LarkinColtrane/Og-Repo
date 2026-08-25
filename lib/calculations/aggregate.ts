/**
 * Aggregation helpers used to roll neighbourhood statistics up to a city-wide view.
 *
 * A note on honesty: a true city median needs the underlying transactions, which a
 * neighbourhood-level dataset does not have. What `weightedMedian` computes is the
 * median *of neighbourhood medians*, weighted by housing stock — a defensible
 * approximation, and a different quantity from a transaction-level median. The
 * distinction is documented rather than papered over.
 */

export interface WeightedValue {
  value: number;
  weight: number;
}

/** The value at which cumulative weight first crosses half the total. */
export function weightedMedian(entries: WeightedValue[]): number | null {
  const usable = entries.filter(
    (entry) => Number.isFinite(entry.value) && entry.weight > 0,
  );
  if (usable.length === 0) return null;

  const sorted = [...usable].sort((a, b) => a.value - b.value);
  const totalWeight = sorted.reduce((sum, entry) => sum + entry.weight, 0);
  const halfway = totalWeight / 2;

  let cumulative = 0;
  for (const entry of sorted) {
    cumulative += entry.weight;
    if (cumulative >= halfway) return entry.value;
  }
  return sorted[sorted.length - 1].value;
}

export function weightedMean(entries: WeightedValue[]): number | null {
  const usable = entries.filter(
    (entry) => Number.isFinite(entry.value) && entry.weight > 0,
  );
  if (usable.length === 0) return null;
  const totalWeight = usable.reduce((sum, entry) => sum + entry.weight, 0);
  const total = usable.reduce((sum, entry) => sum + entry.value * entry.weight, 0);
  return total / totalWeight;
}

export function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

/** Percentage change from `previous` to `current`. Null when there is no baseline. */
export function percentChange(
  current: number | null | undefined,
  previous: number | null | undefined,
): number | null {
  if (
    current === null ||
    current === undefined ||
    previous === null ||
    previous === undefined ||
    previous === 0
  ) {
    return null;
  }
  return Math.round(((current - previous) / previous) * 1000) / 10;
}

/**
 * Difference in **percentage points** between two rates.
 *
 * A rate needs this rather than `percentChange`. Vacancy moving from 2.0% to 1.8%
 * is a 0.2-point fall; calling it "−10%" is arithmetically true and almost always
 * read as something else. Rates get points; levels get percentages.
 */
export function pointChange(
  current: number | null | undefined,
  previous: number | null | undefined,
): number | null {
  if (
    current === null ||
    current === undefined ||
    previous === null ||
    previous === undefined
  ) {
    return null;
  }
  return Math.round((current - previous) * 10) / 10;
}
