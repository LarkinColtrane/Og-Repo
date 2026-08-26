import { cn } from "@/lib/utils";
import { copy } from "@/lib/i18n";

export type RateQuality = "demo" | "live";

/**
 * Provenance for a mortgage rate.
 *
 * The label is chosen by the `quality` flag, which comes from the rate row and
 * the repository — never from a hard-coded string in a component. That is the
 * same rule the market-data source badge follows, and it is what makes the demo
 * labelling reliable: the day a real feed writes `dataQuality: "live"`, every one
 * of these badges changes on its own, and until then none of them can be
 * forgotten.
 */
export function RateQualityBadge({
  quality,
  effectiveDate,
  sourceName,
  className,
}: {
  quality: RateQuality;
  /** ISO date the rate took effect. */
  effectiveDate?: string;
  sourceName?: string;
  className?: string;
}) {
  if (quality === "demo") {
    return (
      <span
        className={cn(
          "inline-flex flex-wrap items-center gap-1 text-[0.6875rem] leading-tight text-ink-muted",
          className,
        )}
      >
        <span
          aria-hidden="true"
          className="inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-warning"
        />
        <span className="font-semibold text-warning-ink">
          {copy.provenance.demoRateLabel}
        </span>
        <span aria-hidden="true">—</span>
        <span>{copy.provenance.demoRateQualifier}</span>
      </span>
    );
  }

  return (
    <span className={cn("text-[0.6875rem] leading-tight text-ink-muted", className)}>
      {sourceName ? `${copy.provenance.sourcePrefix}: ${sourceName}` : null}
      {sourceName && effectiveDate ? <span aria-hidden="true"> · </span> : null}
      {effectiveDate ? `${copy.provenance.effectiveDate} ${effectiveDate}` : null}
    </span>
  );
}

/**
 * The page-level notice. Shown once, near the top of the financing section,
 * rather than repeated on every card where it would become wallpaper.
 */
export function RateDataNotice({
  quality,
  effectiveDate,
  className,
}: {
  quality: RateQuality;
  effectiveDate?: string;
  className?: string;
}) {
  if (quality !== "demo") return null;

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
          {copy.provenance.demoRateLabel}s
        </span>
        <span>{copy.provenance.demoRateExplainer}</span>
      </p>
      {effectiveDate ? (
        <p className="mt-1.5 text-[0.6875rem] text-ink-muted">
          Generated with an effective date of {effectiveDate}.
        </p>
      ) : null}
    </aside>
  );
}
