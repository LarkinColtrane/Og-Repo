"use client";

import { useCallback, useMemo, useState } from "react";
import type {
  BenchmarkFreshness,
  BenchmarkRange,
  BenchmarkSeriesPayload,
} from "@/types/benchmark";
import { BENCHMARK_RANGES } from "@/types/benchmark";
import { copy, interpolate } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { api } from "@/lib/api/client";
import { useApiResource } from "@/lib/hooks/use-api-resource";
import { formatPercent, formatRate } from "@/lib/calculations/format";
import {
  formatObservationDate,
  formatObservationDateShort,
  formatObservationMonth,
} from "@/lib/calculations/business-days";
import { formatUpdatedAt } from "@/lib/periods";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { ChartSkeleton, ErrorState, Skeleton } from "@/components/ui/states";
import { TrendChart, type TrendChartRow } from "@/components/charts/trend-chart";

const RANGE_LABELS: Record<BenchmarkRange, string> = {
  "3m": "3M",
  "1y": "1Y",
  "3y": "3Y",
  "5y": "5Y",
};

const FRESHNESS_TONE: Record<BenchmarkFreshness, BadgeTone> = {
  live: "good",
  stale: "warning",
  demo: "warning",
  unavailable: "neutral",
};

/**
 * The Government of Canada 5-year bond yield.
 *
 * Three things this component is careful about:
 *
 *  1. **It never says "live" on its own authority.** The freshness badge renders
 *     whatever the API computed from the observation date and the publication
 *     schedule. A component cannot decide that data is current.
 *  2. **It states plainly that this is not a mortgage rate.** A yield displayed
 *     beside lender rates, at the same size, in the same units, will be read as
 *     one unless the page says otherwise — so the page says otherwise.
 *  3. **Gaps stay gaps.** Weekends and market holidays are simply absent from
 *     the series and the chart plots observation to observation. No value is
 *     interpolated for a day the Bank published nothing.
 */
export function BenchmarkPanel({ className }: { className?: string }) {
  const [range, setRange] = useState<BenchmarkRange>("1y");

  const fetcher = useCallback(
    (signal: AbortSignal) => api.benchmark({ series: "5y-canada-bond", range }, signal),
    [range],
  );

  const resource = useApiResource<BenchmarkSeriesPayload>(`benchmark:5y:${range}`, fetcher);

  const rows = useMemo<TrendChartRow[]>(
    () =>
      (resource.data?.observations ?? []).map((observation) => ({
        period: observation.observationDate,
        yield: observation.value,
      })),
    [resource.data],
  );

  // Short ranges get day-level ticks; long ones get months, or the axis becomes
  // an unreadable stripe of dates.
  const formatAxisLabel = range === "3m" ? formatObservationDateShort : formatObservationMonth;

  const rangeControl = (
    <SegmentedControl
      size="sm"
      label="Benchmark range"
      value={range}
      onChange={(next) => setRange(next as BenchmarkRange)}
      options={BENCHMARK_RANGES.map((entry) => ({
        value: entry,
        label: RANGE_LABELS[entry],
      }))}
    />
  );

  if (resource.status === "error") {
    return (
      <Card className={className}>
        <CardHeader title={copy.benchmark.sectionTitle} description={copy.benchmark.subtitle} />
        <CardBody>
          <ErrorState message={resource.error} onRetry={resource.reload} />
        </CardBody>
      </Card>
    );
  }

  if (resource.isInitialLoading || !resource.data) {
    return (
      <Card className={className}>
        <CardHeader title={copy.benchmark.sectionTitle} description={copy.benchmark.subtitle} />
        <CardBody>
          <Skeleton className="h-16 w-56" />
          <ChartSkeleton height={240} />
        </CardBody>
      </Card>
    );
  }

  const { snapshot } = resource.data;
  const latest = snapshot.latest;
  const freshness = snapshot.freshness;

  return (
    <div className={cn("space-y-4", className)}>
      <Card>
        <CardHeader
          title={copy.benchmark.sectionTitle}
          description={copy.benchmark.subtitle}
          actions={
            <Badge tone={FRESHNESS_TONE[freshness]}>
              <span
                aria-hidden="true"
                className={cn(
                  "inline-block h-1.5 w-1.5 rounded-full",
                  freshness === "live" ? "bg-good" : freshness === "stale" || freshness === "demo" ? "bg-warning" : "bg-ink-muted",
                )}
              />
              {copy.benchmark.freshness[freshness]}
            </Badge>
          }
        />
        <CardBody>
          <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <p className="eyebrow">{copy.benchmark.latestLabel}</p>
              <p className="mt-1 text-[2.25rem] leading-none font-semibold tracking-[-0.03em] text-ink">
                {latest ? formatRate(latest.value) : "—"}
              </p>
              <p className="mt-2 text-[0.8125rem] text-ink-secondary">
                {latest ? (
                  <>
                    <span className="text-ink-muted">
                      {copy.benchmark.observationDateLabel}:
                    </span>{" "}
                    <span className="font-medium text-ink">
                      {formatObservationDate(latest.observationDate)}
                    </span>
                  </>
                ) : (
                  copy.benchmark.freshnessDetail.unavailable
                )}
              </p>
              {snapshot.changeFromPrevious !== null ? (
                <p className="mt-1 text-[0.8125rem] text-ink-secondary">
                  <span className="text-ink-muted">{copy.benchmark.changeLabel}:</span>{" "}
                  <span
                    className={cn(
                      "font-medium tabular",
                      snapshot.changeFromPrevious > 0
                        ? "text-critical-ink"
                        : snapshot.changeFromPrevious < 0
                          ? "text-good-ink"
                          : "text-ink",
                    )}
                  >
                    {snapshot.changeFromPrevious > 0 ? "+" : snapshot.changeFromPrevious < 0 ? "−" : ""}
                    {Math.abs(snapshot.changeFromPrevious).toFixed(2)} pts
                  </span>
                </p>
              ) : null}
            </div>

            <dl className="min-w-0 shrink-0 space-y-2 rounded-md border border-line bg-surface-2 p-3 sm:max-w-[22rem]">
              <Meta label="Data quality" value={copy.benchmark.freshnessDetail[freshness]} />
              <Meta
                label={copy.benchmark.lastImportLabel}
                value={
                  snapshot.lastSuccessfulImportAt
                    ? formatUpdatedAt(snapshot.lastSuccessfulImportAt)
                    : copy.benchmark.neverImported
                }
              />
              {snapshot.lastFailedImportAt ? (
                <Meta
                  label={copy.benchmark.lastFailureLabel}
                  value={`${formatUpdatedAt(snapshot.lastFailedImportAt)} — ${snapshot.lastFailureMessage ?? "unknown error"}`}
                  tone="critical"
                />
              ) : null}
              {snapshot.businessDayLag !== null ? (
                <Meta
                  label="Publication lag"
                  value={interpolate(copy.benchmark.businessDayLag, {
                    lag: snapshot.businessDayLag,
                  })}
                />
              ) : null}
              {/* The label distinguishes provenance from configuration. While the
                  generated fallback is showing, the Bank of Canada is the source
                  this pipeline *targets*, not the origin of what is on screen —
                  calling it "Source" would credit them for our own numbers. */}
              <Meta
                label={
                  freshness === "demo"
                    ? copy.benchmark.sourceLabelDemo
                    : copy.benchmark.sourceLabelLive
                }
                value={interpolate(copy.benchmark.sourceLine, {
                  code: snapshot.series.upstreamCode,
                })}
              />
            </dl>
          </div>

          <aside className="mt-5 rounded-md border border-accent-line bg-accent-soft px-4 py-3">
            <p className="text-[0.8125rem] font-semibold text-accent">
              {copy.benchmark.notAMortgageRate}
            </p>
            <p className="mt-1 text-[0.8125rem] leading-relaxed text-ink-secondary">
              {copy.benchmark.notAMortgageRateBody}
            </p>
          </aside>
        </CardBody>
      </Card>

      <TrendChart
        title={copy.benchmark.chartTitle}
        description={`${snapshot.series.label}, ${RANGE_LABELS[range]} of business-daily observations. Weekends and market holidays are absent because the Bank of Canada publishes nothing on them.`}
        series={[{ key: "yield", label: snapshot.series.shortLabel }]}
        data={rows}
        unit="percent"
        actions={rangeControl}
        sources={resource.meta?.sources}
        height={280}
        formatAxisLabel={formatAxisLabel}
        formatPointLabel={formatObservationDate}
        className={resource.isRefreshing ? "opacity-70 transition-opacity" : undefined}
      />
    </div>
  );
}

function Meta({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: string;
  tone?: "default" | "critical";
}) {
  return (
    <div>
      <dt className="eyebrow">{label}</dt>
      <dd
        className={cn(
          "mt-0.5 text-[0.75rem] leading-relaxed",
          tone === "critical" ? "text-critical-ink" : "text-ink-secondary",
        )}
      >
        {value}
      </dd>
    </div>
  );
}

/** Percent formatting for a yield, used where a full rate label is too heavy. */
export function formatYield(value: number | null | undefined): string {
  return value === null || value === undefined ? "—" : formatPercent(value, 2);
}
