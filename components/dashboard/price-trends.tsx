"use client";

import { useCallback, useState } from "react";
import type { PropertyType, SaleMarketStat, TrendRange } from "@/types";
import { TREND_RANGES } from "@/types";
import { copy } from "@/lib/i18n";
import { api } from "@/lib/api/client";
import { useApiResource } from "@/lib/hooks/use-api-resource";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { ChartSkeleton, ErrorState } from "@/components/ui/states";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { TrendChart, type TrendChartRow } from "@/components/charts/trend-chart";

/**
 * Interactive price history.
 *
 * Each change of property type or range issues a real request to
 * `/api/neighbourhoods/[slug]/sales`. The alternative — shipping every series to
 * the browser up front and filtering in memory — would look identical and teach
 * nothing, and it stops scaling the moment the dataset is real.
 */
export function PriceTrends({
  slug,
  availablePropertyTypes,
  title = copy.neighbourhoodsPage.priceTrendsTitle,
  propertyType: controlledPropertyType,
}: {
  slug: string;
  availablePropertyTypes: PropertyType[];
  title?: string;
  /**
   * Pass this when the surrounding page already has a property-type control — the
   * Buy dashboard does. The chart then follows that selection and hides its own
   * duplicate control. Two controls for the same choice on one page is a bug, not
   * a convenience: change one and the other silently disagrees.
   */
  propertyType?: PropertyType;
}) {
  const [ownPropertyType, setOwnPropertyType] = useState<PropertyType>(
    availablePropertyTypes[0] ?? "condo",
  );
  const [range, setRange] = useState<TrendRange>("3y");

  const isControlled = controlledPropertyType !== undefined;
  const requested = controlledPropertyType ?? ownPropertyType;
  // Switching neighbourhood can strand a selection the new area has no stock of —
  // Griffintown has no plexes. Fall back rather than request a series that cannot
  // exist and render an empty chart with no explanation.
  const propertyType = availablePropertyTypes.includes(requested)
    ? requested
    : (availablePropertyTypes[0] ?? "condo");

  const fetcher = useCallback(
    (signal: AbortSignal) => api.sales(slug, { propertyType, range }, signal),
    [slug, propertyType, range],
  );

  const resource = useApiResource<SaleMarketStat[]>(
    `sales:${slug}:${propertyType}:${range}`,
    fetcher,
  );

  const controls = (
    <div className="flex flex-wrap items-center gap-2">
      {isControlled ? null : (
        <SegmentedControl
          size="sm"
          label="Property type"
          value={propertyType}
          onChange={setOwnPropertyType}
          options={availablePropertyTypes.map((type) => ({
            value: type,
            label: copy.propertyTypes[type],
          }))}
        />
      )}
      <SegmentedControl
        size="sm"
        label="Time range"
        value={range}
        onChange={setRange}
        options={TREND_RANGES.map((entry) => ({
          value: entry,
          label: copy.ranges[entry],
        }))}
      />
    </div>
  );

  if (resource.status === "error") {
    return (
      <Card>
        <CardHeader title={title} actions={controls} />
        <CardBody>
          <ErrorState message={resource.error} onRetry={resource.reload} />
        </CardBody>
      </Card>
    );
  }

  if (resource.isInitialLoading) {
    return (
      <Card>
        <CardHeader title={title} actions={controls} />
        <CardBody>
          <ChartSkeleton />
        </CardBody>
      </Card>
    );
  }

  const rows: TrendChartRow[] = (resource.data ?? []).map((stat) => ({
    period: stat.period,
    medianPrice: stat.medianPrice,
  }));

  return (
    <TrendChart
      title={title}
      description={`Median ${copy.propertyTypes[propertyType].toLowerCase()} price, ${copy.ranges[range].toLowerCase()} of monthly history.`}
      series={[{ key: "medianPrice", label: copy.metrics.medianPrice.label }]}
      data={rows}
      unit="currency"
      actions={controls}
      sources={resource.meta?.sources}
      className={resource.isRefreshing ? "opacity-70 transition-opacity" : undefined}
    />
  );
}
