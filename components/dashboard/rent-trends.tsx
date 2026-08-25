"use client";

import { useCallback, useMemo, useState } from "react";
import type { BedroomType, RentalMarketStat, TrendRange } from "@/types";
import { BEDROOM_TYPES, TREND_RANGES } from "@/types";
import { copy } from "@/lib/i18n";
import { api } from "@/lib/api/client";
import { useApiResource } from "@/lib/hooks/use-api-resource";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { ToggleGroup } from "@/components/ui/toggle-group";
import { ChartSkeleton, ErrorState } from "@/components/ui/states";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { TrendChart, type TrendChartRow } from "@/components/charts/trend-chart";
import { getChartPalette } from "@/components/charts/chart-theme";
import { useResolvedTheme } from "@/lib/hooks/use-theme";

/**
 * Interactive rent history, with up to four unit sizes plotted together.
 *
 * Four is the ceiling on purpose: the categorical palette was validated as four
 * ordered slots, and a fifth simultaneous line would have to reuse or invent a
 * colour. Since there are exactly four bedroom types, the cap costs nothing here.
 *
 * All four series arrive in one request and the toggles filter locally — unlike
 * the price chart, where each filter is a separate request. Both patterns are
 * legitimate; which one fits depends on whether the filter narrows the data or
 * just changes what is drawn.
 */
export function RentTrends({
  slug,
  title = copy.neighbourhoodsPage.rentTrendsTitle,
}: {
  slug: string;
  title?: string;
}) {
  const [range, setRange] = useState<TrendRange>("3y");
  const [selected, setSelected] = useState<BedroomType[]>([
    "oneBedroom",
    "twoBedroom",
  ]);

  const theme = useResolvedTheme();
  const palette = getChartPalette(theme);

  const fetcher = useCallback(
    (signal: AbortSignal) => api.rent(slug, { range }, signal),
    [slug, range],
  );

  const resource = useApiResource<RentalMarketStat[]>(`rent:${slug}:${range}`, fetcher);

  // Pivot the flat rows into one record per period with a column per unit size,
  // which is the shape a multi-series chart needs.
  const rows = useMemo<TrendChartRow[]>(() => {
    const byPeriod = new Map<string, TrendChartRow>();
    for (const stat of resource.data ?? []) {
      const row = byPeriod.get(stat.period) ?? { period: stat.period };
      row[stat.bedroomType] = stat.averageRent;
      byPeriod.set(stat.period, row);
    }
    return [...byPeriod.values()].sort((a, b) => a.period.localeCompare(b.period));
  }, [resource.data]);

  const controls = (
    <div className="flex flex-wrap items-center gap-2">
      <ToggleGroup
        label="Unit sizes"
        value={selected}
        onChange={setSelected}
        options={BEDROOM_TYPES.map((type, index) => ({
          value: type,
          label: copy.bedroomTypesShort[type],
          colour: palette.series[index],
        }))}
      />
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

  // Series are built from the canonical bedroom order, not selection order, so a
  // unit size always keeps the same colour as others are toggled.
  const series = BEDROOM_TYPES.filter((type) => selected.includes(type)).map((type) => ({
    key: type,
    label: copy.bedroomTypes[type],
  }));

  return (
    <TrendChart
      title={title}
      description={`Average monthly rent, ${copy.ranges[range].toLowerCase()} of monthly history.`}
      series={series}
      data={rows}
      unit="currency"
      actions={controls}
      sources={resource.meta?.sources}
      emptyMessage={copy.chart.noSeries}
      className={resource.isRefreshing ? "opacity-70 transition-opacity" : undefined}
    />
  );
}
