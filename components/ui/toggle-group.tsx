"use client";

import { cn } from "@/lib/utils";

export interface ToggleOption<T extends string> {
  value: T;
  label: string;
  /** Swatch shown beside the label, tying the option to its chart series. */
  colour?: string;
}

/**
 * Multi-select chips for choosing which series to plot.
 *
 * The last selected option cannot be turned off — an empty chart is never what
 * someone meant, and disabling the control communicates that better than letting
 * them clear it and then showing an empty state.
 */
export function ToggleGroup<T extends string>({
  options,
  value,
  onChange,
  label,
  className,
}: {
  options: ToggleOption<T>[];
  value: T[];
  onChange: (value: T[]) => void;
  label: string;
  className?: string;
}) {
  const toggle = (option: T) => {
    if (value.includes(option)) {
      if (value.length === 1) return;
      onChange(value.filter((entry) => entry !== option));
    } else {
      // Preserve the canonical option order so a series never changes colour when
      // another is toggled on or off.
      onChange(options.map((entry) => entry.value).filter((entry) => entry === option || value.includes(entry)));
    }
  };

  return (
    <div
      role="group"
      aria-label={label}
      className={cn("flex flex-wrap items-center gap-1.5", className)}
    >
      {options.map((option) => {
        const selected = value.includes(option.value);
        const isLastSelected = selected && value.length === 1;

        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={selected}
            disabled={isLastSelected}
            onClick={() => toggle(option.value)}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-[0.75rem] font-medium transition-colors",
              selected
                ? "border-line-strong bg-surface text-ink"
                : "border-line bg-transparent text-ink-muted hover:text-ink-secondary",
              isLastSelected && "cursor-default",
            )}
          >
            {option.colour ? (
              <span
                aria-hidden="true"
                className="inline-block h-0.5 w-3 rounded-full"
                style={{ backgroundColor: selected ? option.colour : "currentColor" }}
              />
            ) : null}
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
