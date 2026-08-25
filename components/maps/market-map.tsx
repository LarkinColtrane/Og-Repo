"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import type { ComparisonRow, NeighbourhoodBoundary } from "@/types";
import { cn } from "@/lib/utils";
import { copy } from "@/lib/i18n";
import { formatCompactCurrency, formatCurrency } from "@/lib/calculations/format";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Delta } from "@/components/ui/delta";
import { ConditionBadge } from "@/components/ui/badge";
import { computeBounds, createProjection, featureToPath } from "./geo";

/**
 * The Montréal market map.
 *
 * It has two rendering modes and picks between them honestly:
 *
 *  - **With boundaries** — given a GeoJSON `NeighbourhoodBoundary[]`, it projects
 *    and draws the real outlines. That path is implemented, not stubbed: hand it
 *    the Ville de Montréal borough dataset and it works.
 *  - **Without boundaries** — it renders a schematic tile grid and says so. It
 *    does *not* draw an approximated outline of Montréal. An invented shape that
 *    looks map-like would be read as geography, and being wrong about where a
 *    neighbourhood is would be worse than not drawing it at all.
 *
 * Both modes share the same selection behaviour and the same detail panel, so
 * connecting the real dataset changes what is drawn and nothing else.
 */
export function MarketMap({
  metrics,
  boundaries = [],
  className,
}: {
  metrics: ComparisonRow[];
  boundaries?: NeighbourhoodBoundary[];
  className?: string;
}) {
  const [activeSlug, setActiveSlug] = useState<string | null>(
    metrics[0]?.slug ?? null,
  );

  const active = metrics.find((entry) => entry.slug === activeSlug) ?? null;

  return (
    <Card className={className}>
      <CardHeader
        title={copy.home.mapTitle}
        description={copy.home.mapSubtitle}
      />
      <CardBody>
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1.4fr_1fr]">
          {boundaries.length > 0 ? (
            <BoundaryMap
              boundaries={boundaries}
              metrics={metrics}
              activeSlug={activeSlug}
              onSelect={setActiveSlug}
            />
          ) : (
            <SchematicGrid
              metrics={metrics}
              activeSlug={activeSlug}
              onSelect={setActiveSlug}
            />
          )}

          <DetailPanel row={active} />
        </div>
      </CardBody>
    </Card>
  );
}

/**
 * Choropleth over real outlines. Fill intensity is a single-hue sequential ramp on
 * median condo price — one hue light to dark, never a rainbow.
 */
function BoundaryMap({
  boundaries,
  metrics,
  activeSlug,
  onSelect,
}: {
  boundaries: NeighbourhoodBoundary[];
  metrics: ComparisonRow[];
  activeSlug: string | null;
  onSelect: (slug: string) => void;
}) {
  const { paths, viewBox } = useMemo(() => {
    const features = boundaries.map((boundary) => boundary.feature);
    const bounds = computeBounds(features);
    if (!bounds) return { paths: [], viewBox: "0 0 800 500" };

    const projection = createProjection(bounds, { width: 800, height: 500 });
    return {
      paths: boundaries.map((boundary) => ({
        slug: boundary.slug,
        d: featureToPath(boundary.feature, projection),
      })),
      viewBox: "0 0 800 500",
    };
  }, [boundaries]);

  const prices = metrics
    .map((entry) => entry.medianCondoPrice)
    .filter((value): value is number => value !== null);
  const min = Math.min(...prices);
  const max = Math.max(...prices);

  return (
    <svg
      viewBox={viewBox}
      className="h-auto w-full rounded-md border border-line bg-surface-inset"
      role="group"
      aria-label={copy.home.mapTitle}
    >
      {paths.map((path) => {
        const row = metrics.find((entry) => entry.slug === path.slug);
        const value = row?.medianCondoPrice ?? null;
        const intensity =
          value === null || max === min ? 0.15 : 0.15 + ((value - min) / (max - min)) * 0.7;

        return (
          <path
            key={path.slug}
            d={path.d}
            role="button"
            tabIndex={0}
            aria-label={row?.name ?? path.slug}
            onClick={() => onSelect(path.slug)}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") onSelect(path.slug);
            }}
            className="cursor-pointer transition-opacity hover:opacity-90"
            // Set through `style` rather than presentation attributes so the theme
            // custom properties resolve reliably across browsers.
            style={{
              fill: "var(--accent)",
              fillOpacity: intensity,
              stroke: "var(--surface)",
              strokeWidth: activeSlug === path.slug ? 3 : 1.5,
            }}
          />
        );
      })}
    </svg>
  );
}

/**
 * The no-geography fallback: a grid of tiles, one per neighbourhood, explicitly
 * labelled as a schematic rather than a map.
 */
function SchematicGrid({
  metrics,
  activeSlug,
  onSelect,
}: {
  metrics: ComparisonRow[];
  activeSlug: string | null;
  onSelect: (slug: string) => void;
}) {
  return (
    <div>
      <div
        className="grid grid-cols-2 gap-2 sm:grid-cols-3"
        role="group"
        aria-label={copy.home.mapTitle}
      >
        {metrics.map((row) => {
          const selected = row.slug === activeSlug;
          return (
            <button
              key={row.slug}
              type="button"
              onClick={() => onSelect(row.slug)}
              onMouseEnter={() => onSelect(row.slug)}
              aria-pressed={selected}
              className={cn(
                "rounded-md border px-3 py-2.5 text-left transition-colors",
                selected
                  ? "border-accent bg-accent-soft"
                  : "border-line bg-surface hover:border-line-strong",
              )}
            >
              <span className="block truncate text-[0.8125rem] font-medium text-ink">
                {row.name}
              </span>
              <span className="mt-0.5 block text-[0.75rem] tabular text-ink-secondary">
                {formatCompactCurrency(row.medianCondoPrice)}
              </span>
            </button>
          );
        })}
      </div>

      <p className="mt-3 text-[0.6875rem] leading-relaxed text-ink-muted">
        This is a schematic index, not a geographic map. Real borough outlines
        require the Ville de Montréal boundary dataset; this component renders them
        as soon as that GeoJSON is supplied, and draws nothing shaped like a map
        until then.
      </p>
    </div>
  );
}

function DetailPanel({ row }: { row: ComparisonRow | null }) {
  if (!row) {
    return (
      <div className="flex items-center justify-center rounded-md border border-dashed border-line p-6 text-center text-[0.8125rem] text-ink-secondary">
        {copy.home.mapSubtitle}
      </div>
    );
  }

  return (
    <div className="rounded-md border border-line bg-surface-2 p-4">
      <div className="flex items-start justify-between gap-3">
        <h3 className="text-[1rem] leading-tight font-semibold tracking-[-0.015em] text-ink">
          {row.name}
        </h3>
        <ConditionBadge condition={row.condition} />
      </div>

      <dl className="mt-4 space-y-3">
        <MapMetric
          label={copy.metrics.medianCondoPrice.label}
          value={formatCurrency(row.medianCondoPrice)}
          change={row.priceYoyChange}
        />
        <MapMetric
          label={copy.metrics.averageTwoBedroomRent.label}
          value={formatCurrency(row.twoBedroomRent)}
          change={row.rentYoyChange}
        />
      </dl>

      <Link
        href={`/neighbourhoods/${row.slug}`}
        className="mt-4 inline-flex text-[0.8125rem] font-medium text-accent hover:underline"
      >
        {copy.actions.viewDashboard} →
      </Link>
    </div>
  );
}

function MapMetric({
  label,
  value,
  change,
}: {
  label: string;
  value: string;
  change: number | null;
}) {
  return (
    <div>
      <dt className="eyebrow">{label}</dt>
      <dd className="mt-1 flex flex-wrap items-baseline gap-x-3">
        <span className="text-[1.125rem] font-semibold tracking-[-0.015em] text-ink">
          {value}
        </span>
        <Delta value={change} polarity="neutral" label="year over year" />
      </dd>
    </div>
  );
}
