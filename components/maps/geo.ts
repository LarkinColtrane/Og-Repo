import type { GeoJsonFeature } from "@/types";

/**
 * Minimal GeoJSON → SVG path projection.
 *
 * An equirectangular projection with an `cos(latitude)` correction on the x axis.
 * Over an area the size of the island of Montréal the distortion against a proper
 * conformal projection is not visible, and it avoids pulling in a mapping library
 * for one city.
 */

export interface Projection {
  /** Convert [longitude, latitude] to SVG coordinates. */
  project(coordinate: [number, number]): [number, number];
  width: number;
  height: number;
}

interface Bounds {
  minLon: number;
  maxLon: number;
  minLat: number;
  maxLat: number;
}

export function computeBounds(features: GeoJsonFeature[]): Bounds | null {
  let minLon = Infinity;
  let maxLon = -Infinity;
  let minLat = Infinity;
  let maxLat = -Infinity;

  for (const feature of features) {
    forEachCoordinate(feature, ([lon, lat]) => {
      if (lon < minLon) minLon = lon;
      if (lon > maxLon) maxLon = lon;
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
    });
  }

  if (!Number.isFinite(minLon) || !Number.isFinite(minLat)) return null;
  return { minLon, maxLon, minLat, maxLat };
}

export function createProjection(
  bounds: Bounds,
  size: { width: number; height: number; padding?: number },
): Projection {
  const padding = size.padding ?? 8;
  const midLatRadians = (((bounds.minLat + bounds.maxLat) / 2) * Math.PI) / 180;
  const lonScale = Math.cos(midLatRadians);

  const spanX = (bounds.maxLon - bounds.minLon) * lonScale || 1;
  const spanY = bounds.maxLat - bounds.minLat || 1;

  // One scale for both axes keeps the aspect ratio true; the smaller of the two
  // available scales is the one that fits.
  const scale = Math.min(
    (size.width - padding * 2) / spanX,
    (size.height - padding * 2) / spanY,
  );

  const offsetX = (size.width - spanX * scale) / 2;
  const offsetY = (size.height - spanY * scale) / 2;

  return {
    width: size.width,
    height: size.height,
    project([lon, lat]) {
      const x = (lon - bounds.minLon) * lonScale * scale + offsetX;
      // SVG y grows downward; latitude grows upward.
      const y = (bounds.maxLat - lat) * scale + offsetY;
      return [x, y];
    },
  };
}

/** Build an SVG `d` attribute for a Polygon or MultiPolygon feature. */
export function featureToPath(feature: GeoJsonFeature, projection: Projection): string {
  const polygons =
    feature.geometry.type === "Polygon"
      ? [feature.geometry.coordinates as number[][][]]
      : (feature.geometry.coordinates as number[][][][]);

  const commands: string[] = [];
  for (const polygon of polygons) {
    for (const ring of polygon) {
      ring.forEach((coordinate, index) => {
        const [x, y] = projection.project(coordinate as [number, number]);
        commands.push(`${index === 0 ? "M" : "L"}${round(x)} ${round(y)}`);
      });
      commands.push("Z");
    }
  }
  return commands.join(" ");
}

function forEachCoordinate(
  feature: GeoJsonFeature,
  visit: (coordinate: [number, number]) => void,
): void {
  const polygons =
    feature.geometry.type === "Polygon"
      ? [feature.geometry.coordinates as number[][][]]
      : (feature.geometry.coordinates as number[][][][]);

  for (const polygon of polygons) {
    for (const ring of polygon) {
      for (const coordinate of ring) {
        visit(coordinate as [number, number]);
      }
    }
  }
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}
