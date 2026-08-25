"use client";

import { useId } from "react";
import { cn } from "@/lib/utils";

export interface SelectOption {
  value: string;
  label: string;
}

/**
 * A styled native `<select>`.
 *
 * Native rather than a custom listbox on purpose: it gets keyboard navigation,
 * type-ahead and the platform's own picker on mobile for free, and a bespoke
 * dropdown would have to reimplement all three to be as usable.
 */
export function Select({
  options,
  value,
  onChange,
  label,
  hideLabel = false,
  placeholder,
  size = "md",
  className,
}: {
  options: SelectOption[];
  value: string;
  onChange: (value: string) => void;
  label: string;
  hideLabel?: boolean;
  placeholder?: string;
  size?: "sm" | "md";
  className?: string;
}) {
  const id = useId();

  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <label
        htmlFor={id}
        className={cn("eyebrow", hideLabel && "sr-only")}
      >
        {label}
      </label>
      <div className="relative">
        <select
          id={id}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className={cn(
            "w-full appearance-none rounded-md border border-line-strong bg-surface pr-9 font-medium text-ink",
            "transition-colors hover:border-accent focus:border-accent",
            size === "sm" ? "h-8 pl-2.5 text-[0.8125rem]" : "h-10 pl-3 text-[0.9375rem]",
          )}
        >
          {placeholder ? (
            <option value="" disabled>
              {placeholder}
            </option>
          ) : null}
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-ink-muted"
        >
          <svg width="10" height="6" viewBox="0 0 10 6" fill="none">
            <path
              d="M1 1L5 5L9 1"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </span>
      </div>
    </div>
  );
}
