"use client";

import { useCallback, useMemo, useState } from "react";
import type { BoroughPermitStat, CityPermitSummary, PermitCategory } from "@/types/civic";
import { copy } from "@/lib/i18n";
import { api, type PermitsPayload } from "@/lib/api/client";
import { useApiResource } from "@/lib/hooks/use-api-resource";
import { formatCompactCurrency, formatNumber } from "@/lib/calculations/format";
import { formatPeriod } from "@/lib/periods";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { StatCard } from "@/components/ui/stat-card";
import { ChartSkeleton, EmptyState, ErrorState } from "@/components/ui/states";
import { SourceBadge } from "@/components/data/source-badge";
import { TrendChart, type TrendChartRow } from "@/components/charts/trend-chart";

/**
 * Building activity — permits issued, by month.
 *
 * ## The thing this component is careful about
 *
 * When it is given a neighbourhood, what it receives back is a **borough**
 * statistic. Griffintown does not publish permit counts; Le Sud-Ouest does, and
 * Le Sud-Ouest also contains Saint-Henri, Pointe-Saint-Charles and Ville-Émard.
 *
 * So the heading over these numbers is `attribution.label`, which the API
 * composes from the geography layer — **not** the neighbourhood name this
 * component was handed. That is deliberate and it is the whole point: a
 * component that wrote its own caption could print "Griffintown: 412 permits",
 * which would be a fabricated statistic. This one cannot, because it does not
 * have a way to.
 *
 * The same discipline as `SourceBadge` reading `isDemo` from the data rather
 * than from a prop a caller could forget.
 */

const MONTH_OPTIONS = [
  { value: "12", label: "1Y" },
  { value: "36", label: "3Y" },
  { value: "60", label: "5Y" },
] as const;

const CATEGORY_SERIES: Array<{ key: PermitCategory; label: string }> = [
  { key: "new-construction", label: copy.permits.newConstruction },
  { key: "renovation", label: copy.permits.renovation },
  { key: "demolition", label: copy.permits.demolition },
  { key: "other", label: copy.permits.other },
];

export function BuildingActivity({
  neighbourhoodSlug,
  boroughCode,
  title = copy.permits.title,
  className,
}: {
  /** Resolves to the borough this neighbourhood sits in, with a caveat attached. */
  neighbourhoodSlug?: string;
  /** Or name the borough directly. City-wide when neither is given. */
  boroughCode?: string;
  title?: string;
  className?: string;
}) {
  const [months, setMonths] = useState<string>("36");
  const [view, setView] = useState<"total" | "categories">("total");

  const fetcher = useCallback(
    (signal: AbortSignal) =>
      api.permits(
        {
          neighbourhood: neighbourhoodSlug,
          borough: boroughCode,
          months: Number(months),
        },
        signal,
      ),
    [neighbourhoodSlug, boroughCode, months],
  );

  const resource = useApiResource<PermitsPayload>(
    `permits:${neighbourhoodSlug ?? boroughCode ?? "city"}:${months}`,
    fetcher,
  );

  const payload = resource.data;

  // City-wide when no place was named; otherwise the borough's own rows.
  const rows = useMemo<Array<BoroughPermitStat | CityPermitSummary>>(() => {
    if (!payload) return [];
    return payload.observations.length > 0 ? payload.observations : payload.city;
  }, [payload]);

  const chartRows = useMemo<TrendChartRow[]>(
    () =>
      rows.map((row): TrendChartRow => {
        if (view === "total") {
          return { period: row.period, permitsIssued: row.permitsIssued };
        }
        const entry: TrendChartRow = { period: row.period };
        for (const { key } of CATEGORY_SERIES) entry[key] = row.byCategory[key] ?? 0;
        return entry;
      }),
    [rows, view],
  );

  const latest = rows.at(-1) ?? null;
  const previousYear = rows.length > 12 ? rows[rows.length - 13] : null;
  const yearOverYear =
    latest && previousYear && previousYear.permitsIssued > 0
      ? (latest.permitsIssued - previousYear.permitsIssued) / previousYear.permitsIssued
      : null;

  const attribution = payload?.attribution ?? null;

  /**
   * Whether these numbers are generated.
   *
   * Read from the response, not from a prop — the same rule `SourceBadge`
   * follows. Anything that is not unambiguously `live` counts as demo, so the
   * cautious label is the one that survives a `mixed` response.
   */
  const isDemo = resource.meta?.dataQuality !== "live";
  const placeLabel =
    attribution?.label ?? payload?.boroughName ?? copy.permits.cityTitle;

  if (resource.error) {
    return (
      <Card className={className}>
        <CardHeader title={title} />
        <CardBody>
          <ErrorState message={resource.error} onRetry={resource.reload} />
        </CardBody>
      </Card>
    );
  }

  if (resource.isInitialLoading) {
    return (
      <Card className={className}>
        <CardHeader title={title} />
        <CardBody>
          <ChartSkeleton height={240} />
        </CardBody>
      </Card>
    );
  }

  if (rows.length === 0) {
    return (
      <Card className={className}>
        <CardHeader title={title} />
        <CardBody>
          <EmptyState body={copy.permits.empty} />
        </CardBody>
      </Card>
    );
  }

  return (
    <Card className={className}>
      <CardHeader
        title={title}
        description={
          <span className="block space-y-1.5">
            {/* The place name comes from the API's attribution object, never
                from the slug this component was handed. */}
            <span className="block font-medium text-ink-secondary">{placeLabel}</span>
            {/* A generated figure must never sit under a sentence describing
                what the Ville de Montréal publishes — a reader would reasonably
                conclude the city published this one. */}
            <span className="block">
              {isDemo ? copy.permits.demoDescription : copy.permits.description}
            </span>
          </span>
        }
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <SegmentedControl
              size="sm"
              label="Permit view"
              value={view}
              onChange={(next) => setView(next as "total" | "categories")}
              options={[
                { value: "total", label: "Total" },
                { value: "categories", label: "By type" },
              ]}
            />
            <SegmentedControl
              size="sm"
              label="History length"
              value={months}
              onChange={setMonths}
              options={MONTH_OPTIONS.map((option) => ({ ...option }))}
            />
          </div>
        }
      />

      <CardBody>
        {/* The coverage caveat. Rendered whenever the figures describe a wider
            area than the place the reader asked about — and the text comes from
            the geography registry, so it is specific about *what else* is in
            the borough rather than a generic disclaimer. */}
        {attribution && attribution.coverage === "part-of" ? (
          <div className="mb-4 rounded-md border border-line bg-surface-inset px-3 py-2.5">
            <p className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-[0.8125rem] leading-relaxed text-ink-secondary">
              <Badge tone="neutral">{copy.provenance.boroughFigure}</Badge>
              <span>{attribution.note}</span>
            </p>
          </div>
        ) : null}

        <div className="mb-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <StatCard
            size="compact"
            label={copy.permits.permitsIssued}
            value={formatNumber(latest?.permitsIssued ?? 0)}
            change={yearOverYear}
            changePolarity="neutral"
            footnote={latest ? formatPeriod(latest.period) : undefined}
          />
          <StatCard
            size="compact"
            label={copy.permits.dwellingUnits}
            // `null` is "the extract carried no count", which is not zero. The
            // interface says so rather than printing a confident 0.
            value={
              latest?.dwellingUnitsCreated === null || latest === null
                ? copy.permits.unitsUnknown
                : formatNumber(latest.dwellingUnitsCreated)
            }
            hint="Units the permits declare creating. Not completions — the building still has to happen."
          />
          <StatCard
            size="compact"
            label={copy.permits.declaredValue}
            value={
              latest?.declaredWorkValue === null || latest === null
                ? copy.permits.unitsUnknown
                : formatCompactCurrency(latest.declaredWorkValue)
            }
            hint="Stated by applicants to calculate the permit fee. A relative signal, not a construction cost."
          />
        </div>

        <TrendChart
          title={title}
          unit="count"
          height={240}
          series={
            view === "total"
              ? [{ key: "permitsIssued", label: copy.permits.permitsIssued }]
              : CATEGORY_SERIES.map(({ key, label }) => ({ key, label }))
          }
          data={chartRows}
          emptyMessage={copy.permits.empty}
          className="border-0 bg-transparent p-0 shadow-none"
        />

        <p className="mt-4 border-t border-line pt-3 text-[0.75rem] leading-relaxed text-ink-muted">
          {copy.permits.caveat}
        </p>

        {resource.meta ? (
          <SourceBadge sources={resource.meta.sources} className="mt-2" />
        ) : null}
      </CardBody>
    </Card>
  );
}
