import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Table primitives.
 *
 * The wrapper owns the horizontal scroll so a wide table never makes the page
 * scroll sideways — the single most common way a data-heavy layout breaks on a
 * phone. Numeric cells use tabular figures because a column of numbers has to
 * align vertically; text cells do not.
 */
export function TableWrapper({
  children,
  className,
  label,
}: {
  children: ReactNode;
  className?: string;
  /** Accessible name for the scroll region. */
  label?: string;
}) {
  return (
    <div
      className={cn("-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0", className)}
      tabIndex={0}
      role="region"
      aria-label={label}
    >
      {children}
    </div>
  );
}

export function Table({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <table className={cn("w-full min-w-full border-collapse text-left", className)}>
      {children}
    </table>
  );
}

export function Th({
  children,
  numeric = false,
  sticky = false,
  scope = "col",
  className,
}: {
  children: ReactNode;
  numeric?: boolean;
  /** Pins the first column while the rest scrolls. */
  sticky?: boolean;
  scope?: "col" | "row";
  className?: string;
}) {
  return (
    <th
      scope={scope}
      className={cn(
        "border-b border-line px-3 py-2.5 text-[0.6875rem] font-semibold tracking-[0.06em] whitespace-nowrap text-ink-muted uppercase",
        numeric && "text-right",
        sticky && "sticky left-0 z-10 bg-surface",
        className,
      )}
    >
      {children}
    </th>
  );
}

export function Td({
  children,
  numeric = false,
  sticky = false,
  className,
}: {
  children: ReactNode;
  numeric?: boolean;
  sticky?: boolean;
  className?: string;
}) {
  return (
    <td
      className={cn(
        "border-b border-line px-3 py-2.5 text-[0.875rem] whitespace-nowrap text-ink",
        numeric && "tabular text-right",
        sticky && "sticky left-0 z-10 bg-surface font-medium",
        className,
      )}
    >
      {children}
    </td>
  );
}

/** Row header for a comparison table, where the metric name labels the row. */
export function RowHeader({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <th
      scope="row"
      className={cn(
        "sticky left-0 z-10 border-b border-line bg-surface px-3 py-2.5 text-[0.8125rem] font-medium whitespace-nowrap text-ink-secondary",
        className,
      )}
    >
      {children}
    </th>
  );
}
