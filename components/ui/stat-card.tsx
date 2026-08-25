import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Delta, type DeltaPolarity } from "./delta";
import { InfoHint } from "./info-hint";

/**
 * The workhorse of the platform: one labelled number, optionally with a change
 * indicator and an explanation of what it measures.
 *
 * Per the stat-tile contract: sentence-case label, semibold value in the system
 * sans with proportional figures (tabular digits look loose at display sizes), and
 * a delta that names the period it compares against.
 */
export function StatCard({
  label,
  value,
  hint,
  change,
  changePolarity = "neutral",
  changeLabel = "year over year",
  changeFormat = "percent",
  footnote,
  size = "default",
  className,
}: {
  label: string;
  value: ReactNode;
  /** One line explaining what the metric measures. Shown behind an info affordance. */
  hint?: string;
  change?: number | null;
  changePolarity?: DeltaPolarity;
  changeLabel?: string;
  changeFormat?: "percent" | "points";
  footnote?: ReactNode;
  size?: "default" | "large" | "compact";
  className?: string;
}) {
  const valueClass =
    size === "large"
      ? "text-[2rem] leading-[1.15] sm:text-[2.25rem]"
      : size === "compact"
        ? "text-[1.25rem] leading-tight"
        : "text-[1.625rem] leading-tight";

  return (
    <div
      className={cn(
        "flex h-full flex-col rounded-md border border-line bg-surface p-4 shadow-card sm:p-5",
        className,
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <span className="eyebrow">{label}</span>
        {hint ? <InfoHint label={label} text={hint} /> : null}
      </div>

      <div className="mt-3">
        <div className={cn("font-semibold tracking-[-0.02em] text-ink", valueClass)}>
          {value}
        </div>
        {change !== undefined ? (
          <div className="mt-2">
            <Delta
              value={change}
              polarity={changePolarity}
              label={changeLabel}
              format={changeFormat}
            />
          </div>
        ) : null}
      </div>

      {/* `mt-auto` pins the footnote to the bottom so cards in a row align on it,
          while the value stays anchored under its label rather than drifting down
          in cards that have no change indicator. */}
      {footnote ? (
        <div className="mt-auto pt-3 text-[0.75rem] leading-snug text-ink-muted">
          {footnote}
        </div>
      ) : null}
    </div>
  );
}

/** A row of stat cards that reflows sensibly from four columns down to one. */
export function StatGrid({
  children,
  columns = 4,
  className,
}: {
  children: ReactNode;
  columns?: 2 | 3 | 4;
  className?: string;
}) {
  const columnClass =
    columns === 2
      ? "sm:grid-cols-2"
      : columns === 3
        ? "sm:grid-cols-2 lg:grid-cols-3"
        : "sm:grid-cols-2 lg:grid-cols-4";

  return (
    <div className={cn("grid grid-cols-1 gap-3 sm:gap-4", columnClass, className)}>
      {children}
    </div>
  );
}
