import type { Attribution } from "@/types";
import { DATA_SOURCES } from "@/data/demo/sources";

/**
 * Turns source ids into the provenance objects the UI renders.
 *
 * The `isDemo` flag is the important field: it is what makes a statistic render
 * "Demo data · Not live market data" instead of "Source: CMHC · Updated Oct. 2026".
 * A statistic whose source cannot be resolved is treated as demo rather than
 * silently presented as authoritative — failing toward the more cautious label.
 */
export function getAttribution(sourceId: string): Attribution {
  const source = DATA_SOURCES.find((entry) => entry.id === sourceId);
  if (!source) {
    return {
      sourceId,
      sourceName: "Unknown source",
      updatedAt: null,
      isDemo: true,
    };
  }
  return {
    sourceId: source.id,
    sourceName: source.name,
    updatedAt: source.lastUpdated,
    isDemo: source.sourceType === "demo",
  };
}

/** Attributions for a set of source ids, de-duplicated and stable in order. */
export function getAttributions(sourceIds: Array<string | undefined | null>): Attribution[] {
  const seen = new Set<string>();
  const result: Attribution[] = [];
  for (const id of sourceIds) {
    if (!id || seen.has(id)) continue;
    seen.add(id);
    result.push(getAttribution(id));
  }
  return result;
}
