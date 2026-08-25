import type { ReactNode } from "react";
import type { Attribution } from "@/types";
import { cn } from "@/lib/utils";
import { copy } from "@/lib/i18n";
import { formatUpdatedAt } from "@/lib/periods";

/**
 * Provenance, rendered.
 *
 * This is the component the transparency requirement lives in. Any statistic on
 * screen can say where it came from and when it was refreshed — and while the app
 * runs on generated data, it says so plainly instead of quietly implying the
 * numbers are real. The `isDemo` flag comes from the data layer, not from a prop a
 * caller could forget, so a demo figure cannot be presented as a live one by
 * accident.
 */
export function SourceBadge({
  sources,
  className,
}: {
  sources: Attribution[];
  className?: string;
}) {
  if (sources.length === 0) return null;

  const demo = sources.some((source) => source.isDemo);

  if (demo) {
    return (
      <p
        className={cn(
          "inline-flex items-center gap-1.5 text-[0.6875rem] tracking-[0.01em] text-ink-muted",
          className,
        )}
      >
        <span
          aria-hidden="true"
          className="inline-block h-1.5 w-1.5 rounded-full bg-warning"
        />
        <span className="font-semibold text-warning-ink">
          {copy.provenance.demoLabel}
        </span>
        <span aria-hidden="true">·</span>
        <span>{copy.provenance.demoQualifier}</span>
      </p>
    );
  }

  return (
    <p className={cn("text-[0.6875rem] text-ink-muted", className)}>
      {sources.map((source, index) => (
        <span key={source.sourceId}>
          {index > 0 ? <span aria-hidden="true"> · </span> : null}
          {copy.provenance.sourcePrefix}: {source.sourceName}
          {source.updatedAt ? (
            <>
              {" "}
              <span aria-hidden="true">·</span> {copy.provenance.updatedPrefix}{" "}
              {formatUpdatedAt(source.updatedAt)}
            </>
          ) : null}
        </span>
      ))}
    </p>
  );
}

/**
 * The site-wide notice. Shown once per page rather than on every card, so it stays
 * readable instead of becoming wallpaper the eye learns to skip.
 */
export function DemoDataNotice({ className }: { className?: string }) {
  return (
    <aside
      className={cn(
        "rounded-md border border-warning/40 bg-warning/8 px-4 py-3",
        className,
      )}
    >
      <p className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-[0.8125rem] leading-relaxed text-ink-secondary">
        <span className="inline-flex items-center gap-1.5 font-semibold text-warning-ink">
          <span
            aria-hidden="true"
            className="inline-block h-1.5 w-1.5 rounded-full bg-warning"
          />
          {copy.provenance.demoLabel}
        </span>
        <span>{copy.provenance.demoExplainer}</span>
      </p>
    </aside>
  );
}

/** Marks a figure the platform computed itself rather than imported. */
export function DerivedNote({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <p className={cn("text-[0.6875rem] leading-relaxed text-ink-muted", className)}>
      <span className="font-semibold">{copy.provenance.derivedPrefix}</span>
      <span aria-hidden="true"> · </span>
      {children}
    </p>
  );
}
