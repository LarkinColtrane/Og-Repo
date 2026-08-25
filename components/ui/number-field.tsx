"use client";

import { useId, useState } from "react";
import { cn, toNumber } from "@/lib/utils";

/**
 * A numeric input for the calculators.
 *
 * It keeps the raw text in local state and reports a parsed number upward. Binding
 * the input directly to a number makes the field impossible to clear — deleting the
 * last digit yields `NaN`, the parent coerces it back to `0`, and a `0` reappears
 * under the cursor. Holding the text separately lets someone empty a field, type,
 * and have the calculation follow along.
 */
export function NumberField({
  label,
  value,
  onChange,
  prefix,
  suffix,
  hint,
  min = 0,
  max,
  step = 1,
  className,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  /** Leading adornment, e.g. `$`. */
  prefix?: string;
  /** Trailing adornment, e.g. `%` or `years`. */
  suffix?: string;
  hint?: string;
  min?: number;
  max?: number;
  step?: number;
  className?: string;
}) {
  const id = useId();
  const [text, setText] = useState(() => String(value));
  const [lastValue, setLastValue] = useState(value);

  // Re-sync when the value changes from outside — a reset button, or a new
  // neighbourhood prefilling the form. The guard matters: while someone is typing,
  // the parent's value is being driven *by* this field, and overwriting the text
  // with `String(value)` would eat a trailing decimal point mid-entry.
  if (value !== lastValue) {
    setLastValue(value);
    if (toNumber(text, Number.NaN) !== value) setText(String(value));
  }

  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <label htmlFor={id} className="eyebrow">
        {label}
      </label>
      <div className="relative flex items-center">
        {prefix ? (
          <span
            aria-hidden="true"
            className="pointer-events-none absolute left-3 text-[0.875rem] text-ink-muted"
          >
            {prefix}
          </span>
        ) : null}
        <input
          id={id}
          type="number"
          inputMode="decimal"
          value={text}
          min={min}
          max={max}
          step={step}
          onChange={(event) => {
            setText(event.target.value);
            onChange(toNumber(event.target.value, 0));
          }}
          onBlur={() => setText(String(value))}
          className={cn(
            "h-10 w-full rounded-md border border-line-strong bg-surface text-[0.9375rem] font-medium tabular text-ink",
            "transition-colors hover:border-accent focus:border-accent",
            "[appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none",
            prefix ? "pl-7" : "pl-3",
            suffix ? "pr-14" : "pr-3",
          )}
        />
        {suffix ? (
          <span
            aria-hidden="true"
            className="pointer-events-none absolute right-3 text-[0.8125rem] text-ink-muted"
          >
            {suffix}
          </span>
        ) : null}
      </div>
      {hint ? <p className="text-[0.6875rem] text-ink-muted">{hint}</p> : null}
    </div>
  );
}

/** A slider for values people prefer to explore rather than type: rates, terms. */
export function RangeField({
  label,
  value,
  onChange,
  min,
  max,
  step = 1,
  format,
  className,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  min: number;
  max: number;
  step?: number;
  format: (value: number) => string;
  className?: string;
}) {
  const id = useId();

  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <div className="flex items-baseline justify-between">
        <label htmlFor={id} className="eyebrow">
          {label}
        </label>
        <span className="text-[0.875rem] font-medium tabular text-ink">
          {format(value)}
        </span>
      </div>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-surface-inset accent-[var(--accent)]"
      />
    </div>
  );
}
