import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import type { MarketConditionLabel } from "@/types";
import { copy } from "@/lib/i18n";

export type BadgeTone = "neutral" | "accent" | "good" | "warning" | "critical";

const TONE_CLASSES: Record<BadgeTone, string> = {
  neutral: "border-line bg-surface-inset text-ink-secondary",
  accent: "border-accent-line bg-accent-soft text-accent",
  good: "border-good/30 bg-good/10 text-good-ink",
  warning: "border-warning/40 bg-warning/10 text-warning-ink",
  critical: "border-critical/30 bg-critical/10 text-critical-ink",
};

export function Badge({
  children,
  tone = "neutral",
  className,
}: {
  children: ReactNode;
  tone?: BadgeTone;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-sm border px-2 py-0.5 text-[0.6875rem] font-semibold tracking-[0.02em] whitespace-nowrap",
        TONE_CLASSES[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

/**
 * The market-condition classification.
 *
 * Buyer's and seller's markets are opposite states, not good and bad ones — which
 * side a reader is on decides that. So the badge uses the neutral and accent tones
 * rather than the reserved status colours, and always spells the classification out
 * in words.
 */
export function ConditionBadge({
  condition,
  className,
}: {
  condition: MarketConditionLabel;
  className?: string;
}) {
  const tone: BadgeTone = condition === "balanced" ? "neutral" : "accent";
  return (
    <Badge tone={tone} className={className}>
      <span
        aria-hidden="true"
        className={cn(
          "inline-block h-1.5 w-1.5 rounded-full",
          condition === "sellers"
            ? "bg-accent"
            : condition === "buyers"
              ? "bg-ink-secondary"
              : "bg-ink-muted",
        )}
      />
      {copy.conditions[condition]}
    </Badge>
  );
}
