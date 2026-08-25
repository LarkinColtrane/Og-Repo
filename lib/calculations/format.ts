/**
 * Number formatting.
 *
 * Deliberately hand-rolled rather than `Intl.NumberFormat`. ICU versions differ
 * between Node and the browser (non-breaking spaces, compact-notation rounding),
 * and a single character of difference in a server-rendered number becomes a React
 * hydration mismatch. Formatting the digits ourselves keeps server and client
 * output byte-identical.
 */

function groupDigits(value: string): string {
  return value.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

function round(value: number, decimals: number): string {
  const fixed = Math.abs(value).toFixed(decimals);
  const [whole, fraction] = fixed.split(".");
  const grouped = groupDigits(whole);
  return fraction ? `${grouped}.${fraction}` : grouped;
}

/** `$625,000` — currency with no cents, which is how housing figures are read. */
export function formatCurrency(value: number | null | undefined, decimals = 0): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  const sign = value < 0 ? "−" : "";
  return `${sign}$${round(value, decimals)}`;
}

/**
 * `$625K`, `$1.15M` — for stat tiles, where the exact dollar is noise. The full
 * value still belongs in a tooltip or table.
 */
export function formatCompactCurrency(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  const sign = value < 0 ? "−" : "";
  const abs = Math.abs(value);
  if (abs >= 1_000_000) {
    const millions = abs / 1_000_000;
    return `${sign}$${millions >= 10 ? round(millions, 1) : round(millions, 2)}M`;
  }
  if (abs >= 10_000) return `${sign}$${round(abs / 1000, 0)}K`;
  return `${sign}$${round(abs, 0)}`;
}

/** `1,842` */
export function formatNumber(value: number | null | undefined, decimals = 0): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  const sign = value < 0 ? "−" : "";
  return `${sign}${round(value, decimals)}`;
}

/** `4.8%` — the value is already a percentage, not a fraction. */
export function formatPercent(
  value: number | null | undefined,
  decimals = 1,
): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  const sign = value < 0 ? "−" : "";
  return `${sign}${round(value, decimals)}%`;
}

/** `+4.8%` / `−1.2%` — always signed, for change indicators. */
export function formatSignedPercent(
  value: number | null | undefined,
  decimals = 1,
): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  if (value === 0) return `0.0%`;
  const sign = value > 0 ? "+" : "−";
  return `${sign}${round(value, decimals)}%`;
}

/** `+$120` / `−$85` — signed dollars, for cash-flow figures. */
export function formatSignedCurrency(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  if (value === 0) return "$0";
  const sign = value > 0 ? "+" : "−";
  return `${sign}$${round(Math.abs(value), 0)}`;
}

/** `26 days` */
export function formatDays(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return `${round(value, 0)} ${Math.round(value) === 1 ? "day" : "days"}`;
}

/** Axis ticks: `$625K`, `1.8%`, `1,240`. */
export function formatAxisValue(value: number, unit: "currency" | "percent" | "count") {
  if (unit === "currency") return formatCompactCurrency(value);
  if (unit === "percent") return `${round(value, value < 10 ? 1 : 0)}%`;
  return formatNumber(value);
}
