import type { CSSProperties, ReactNode } from "react";
import { cn } from "@/lib/utils";
import { copy } from "@/lib/i18n";
import { Button } from "./button";

/**
 * Loading, empty and error states.
 *
 * Every asynchronous surface in the app uses these three rather than rendering
 * nothing — a blank panel is indistinguishable from a broken one, and "no data" is
 * a real answer that deserves to be said out loud.
 */

/** A placeholder block sized to the content it stands in for. */
export function Skeleton({
  className,
  style,
}: {
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <div
      className={cn("animate-pulse rounded-sm bg-surface-inset", className)}
      style={style}
      aria-hidden="true"
    />
  );
}

export function ChartSkeleton({ height = 280 }: { height?: number }) {
  return (
    <div className="space-y-3 p-1" role="status" aria-label={copy.states.loading}>
      <Skeleton className="h-3 w-32" />
      <Skeleton style={{ height }} className="w-full" />
      <span className="sr-only">{copy.states.loading}</span>
    </div>
  );
}

export function StatCardSkeleton() {
  return (
    <div className="rounded-md border border-line bg-surface p-5 shadow-card">
      <Skeleton className="h-3 w-24" />
      <Skeleton className="mt-4 h-7 w-32" />
      <Skeleton className="mt-3 h-3 w-20" />
    </div>
  );
}

export function EmptyState({
  title = copy.states.emptyTitle,
  body = copy.states.emptyBody,
  className,
}: {
  title?: string;
  body?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center rounded-md border border-dashed border-line px-6 py-10 text-center",
        className,
      )}
    >
      <p className="text-[0.9375rem] font-medium text-ink">{title}</p>
      <p className="mt-1.5 max-w-md text-[0.8125rem] leading-relaxed text-ink-secondary">
        {body}
      </p>
    </div>
  );
}

export function ErrorState({
  message,
  onRetry,
  className,
}: {
  message?: string | null;
  onRetry?: () => void;
  className?: string;
}) {
  return (
    <div
      role="alert"
      className={cn(
        "flex flex-col items-center justify-center rounded-md border border-critical/30 bg-critical/5 px-6 py-10 text-center",
        className,
      )}
    >
      <p className="text-[0.9375rem] font-medium text-ink">{copy.states.error}</p>
      {message ? (
        <p className="mt-1.5 max-w-md text-[0.8125rem] leading-relaxed text-ink-secondary">
          {message}
        </p>
      ) : null}
      {onRetry ? (
        <Button variant="secondary" size="sm" className="mt-4" onClick={onRetry}>
          {copy.actions.retry}
        </Button>
      ) : null}
    </div>
  );
}
