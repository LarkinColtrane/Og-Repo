import { cn } from "@/lib/utils";
import { formatSignedPercent } from "@/lib/calculations/format";

/**
 * A signed change indicator.
 *
 * `polarity` exists because "up" is not universally good. A rising price is
 * positive news for an owner and negative for a buyer, and a rising vacancy rate
 * is neither — so the caller says what the direction means rather than the
 * component assuming green-is-up. Colour never carries the meaning alone: the
 * arrow glyph and the comparison label are always present.
 */
export type DeltaPolarity = "up-good" | "up-bad" | "neutral";

export function Delta({
  value,
  polarity = "neutral",
  label,
  format = "percent",
  className,
}: {
  value: number | null | undefined;
  polarity?: DeltaPolarity;
  /** What the change is measured against, e.g. "year over year". */
  label?: string;
  /**
   * `points` for a change in a rate (vacancy moving 2.0% → 1.8% is −0.2 points,
   * not −10%). `percent` for a change in a level.
   */
  format?: "percent" | "points";
  className?: string;
}) {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return (
      <span className={cn("text-[0.8125rem] text-ink-muted", className)}>
        No comparison period
      </span>
    );
  }

  const rising = value > 0;
  const flat = Math.abs(value) < 0.05;

  const tone =
    flat || polarity === "neutral"
      ? "text-ink-secondary"
      : (rising && polarity === "up-good") || (!rising && polarity === "up-bad")
        ? "text-good-ink"
        : "text-critical-ink";

  return (
    <span
      className={cn("inline-flex items-baseline gap-1.5 text-[0.8125rem]", className)}
    >
      <span className={cn("font-medium tabular", tone)}>
        <span aria-hidden="true" className="mr-0.5">
          {flat ? "→" : rising ? "▲" : "▼"}
        </span>
        {format === "points"
          ? `${value > 0 ? "+" : value < 0 ? "−" : ""}${Math.abs(value).toFixed(1)} pts`
          : formatSignedPercent(value)}
      </span>
      {label ? <span className="text-ink-muted">{label}</span> : null}
    </span>
  );
}
