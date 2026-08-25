"use client";

import { cn } from "@/lib/utils";

export interface SegmentOption<T extends string> {
  value: T;
  label: string;
  /** Rendered but not selectable, e.g. a property type this area has none of. */
  disabled?: boolean;
}

/**
 * The filter control used above every chart: property type, unit size, time range.
 *
 * Implemented as a radio group rather than a row of buttons, so arrow keys move
 * between options and screen readers announce "2 of 4 selected" — the semantics a
 * mutually exclusive choice actually has.
 */
export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  label,
  size = "md",
  className,
}: {
  options: SegmentOption<T>[];
  value: T;
  onChange: (value: T) => void;
  /** Accessible name for the group. */
  label: string;
  size?: "sm" | "md";
  className?: string;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={cn(
        "inline-flex max-w-full items-center gap-0.5 overflow-x-auto rounded-md border border-line bg-surface-inset p-0.5",
        className,
      )}
    >
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={selected}
            disabled={option.disabled}
            onClick={() => onChange(option.value)}
            className={cn(
              "rounded-[5px] font-medium whitespace-nowrap transition-colors duration-150",
              size === "sm" ? "px-2.5 py-1 text-[0.75rem]" : "px-3 py-1.5 text-[0.8125rem]",
              selected
                ? "bg-surface text-ink shadow-card"
                : "text-ink-secondary hover:text-ink",
              option.disabled && "cursor-not-allowed opacity-40 hover:text-ink-secondary",
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
