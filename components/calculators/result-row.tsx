import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { InfoHint } from "@/components/ui/info-hint";

/**
 * One line of a calculator's output. `emphasis` marks the figure a reader is
 * looking for — there should be at most one per group, or nothing stands out.
 */
export function ResultRow({
  label,
  value,
  hint,
  emphasis = false,
  tone = "default",
  className,
}: {
  label: string;
  value: ReactNode;
  hint?: string;
  emphasis?: boolean;
  tone?: "default" | "good" | "critical";
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex items-baseline justify-between gap-4 py-2",
        emphasis && "border-t border-line pt-3",
        className,
      )}
    >
      <span
        className={cn(
          "flex items-center gap-1.5 text-[0.8125rem]",
          emphasis ? "font-medium text-ink" : "text-ink-secondary",
        )}
      >
        {label}
        {hint ? <InfoHint label={label} text={hint} /> : null}
      </span>
      <span
        className={cn(
          "shrink-0 tabular",
          emphasis
            ? "text-[1.125rem] font-semibold tracking-[-0.015em]"
            : "text-[0.875rem] font-medium",
          tone === "good"
            ? "text-good-ink"
            : tone === "critical"
              ? "text-critical-ink"
              : "text-ink",
        )}
      >
        {value}
      </span>
    </div>
  );
}

/** A titled group of result rows. */
export function ResultGroup({
  title,
  children,
  className,
}: {
  title: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={className}>
      <p className="eyebrow mb-1">{title}</p>
      <div>{children}</div>
    </div>
  );
}
