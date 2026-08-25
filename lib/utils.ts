/**
 * Conditional class names. Falsy entries are dropped, so
 * `cn("card", isActive && "card--active")` reads cleanly at the call site.
 */
export function cn(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(" ");
}

/** Clamp a number into a range. */
export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Parse a value from a numeric text input. Returns `fallback` for anything that is
 * not a finite number, which keeps a half-typed field from crashing a calculator.
 */
export function toNumber(value: string | number | null | undefined, fallback = 0): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : fallback;
  if (value === null || value === undefined || value.trim() === "") return fallback;
  const parsed = Number(value.replace(/[^0-9.\-]/g, ""));
  return Number.isFinite(parsed) ? parsed : fallback;
}
