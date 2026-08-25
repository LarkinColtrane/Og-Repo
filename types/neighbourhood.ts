/**
 * Neighbourhood reference data — the dimension table the market statistics hang off.
 * Adding a neighbourhood means adding one entry to the seed table in
 * data/demo/neighbourhood-profiles.ts (or one row to the `neighbourhoods` table);
 * nothing in the UI needs to change.
 */
export interface Neighbourhood {
  id: string;
  name: string;
  /** URL segment: `/neighbourhoods/plateau-mont-royal`. */
  slug: string;
  /** The Montréal borough (arrondissement) or linked city the area sits in. */
  borough: string;
  latitude: number;
  longitude: number;
  /**
   * A neutral description of the built form and location of the area.
   *
   * This is deliberately *not* a market claim. Anything of the form "prices are
   * rising" or "demand is strong" has to be computed from the statistics — see
   * `buildMarketSummary` — so that the copy can never drift away from the data.
   */
  profile: string;
}

/**
 * Where a neighbourhood's outline would come from once real geography is wired up.
 * The map component accepts this shape and renders nothing until it is supplied —
 * boundaries are never approximated or invented.
 */
export interface NeighbourhoodBoundary {
  slug: string;
  /** A GeoJSON Feature whose geometry is a Polygon or MultiPolygon. */
  feature: GeoJsonFeature;
}

export interface GeoJsonFeature {
  type: "Feature";
  properties: Record<string, unknown>;
  geometry: {
    type: "Polygon" | "MultiPolygon";
    coordinates: number[][][] | number[][][][];
  };
}

export interface GeoJsonFeatureCollection {
  type: "FeatureCollection";
  features: GeoJsonFeature[];
}
