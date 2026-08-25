/**
 * Chart colour tokens.
 *
 * ⚠️ These hexes mirror the custom properties in app/globals.css. They are
 * duplicated here because Recharts writes SVG presentation attributes, and passing
 * a `var(--series-1)` through one is not reliable across browsers — so the values
 * have to reach the renderer as literals. If you change a series colour, change it
 * in both places.
 *
 * The categorical order is the colour-blind-safety mechanism, not a preference:
 * the palette was validated as an ordered set in both themes, so series are
 * assigned slot 1, 2, 3, 4 in order and the order is never shuffled or cycled. A
 * fifth simultaneous series is not supported by design — split into small
 * multiples instead.
 */

export type ResolvedTheme = "light" | "dark";

export interface ChartPalette {
  series: [string, string, string, string];
  grid: string;
  axis: string;
  tickText: string;
  surface: string;
  crosshair: string;
}

const LIGHT: ChartPalette = {
  series: ["#2a78d6", "#eb6834", "#1baf7a", "#eda100"],
  grid: "#e1e0d9",
  axis: "#c3c2b7",
  tickText: "#898781",
  surface: "#ffffff",
  crosshair: "#c9c7c0",
};

const DARK: ChartPalette = {
  series: ["#3987e5", "#d95926", "#199e70", "#c98500"],
  grid: "#26262a",
  axis: "#383835",
  tickText: "#8b8a84",
  surface: "#141416",
  crosshair: "#383835",
};

export function getChartPalette(theme: ResolvedTheme): ChartPalette {
  return theme === "dark" ? DARK : LIGHT;
}

/** Series colour for a slot index, clamped to the four validated slots. */
export function seriesColor(palette: ChartPalette, index: number): string {
  return palette.series[Math.min(index, palette.series.length - 1)];
}

/** Shared geometry so every chart in the app has the same weight and rhythm. */
export const CHART_SPEC = {
  lineWidth: 2,
  activeDotRadius: 4,
  activeDotRingWidth: 2,
  barMaxWidth: 24,
  barRadius: 4,
  gridDash: undefined,
  height: 300,
  compactHeight: 220,
} as const;
