"use client";

import { useCallback, useState } from "react";
import type { ComparisonRow } from "@/types";
import { copy } from "@/lib/i18n";
import { api } from "@/lib/api/client";
import { useApiResource } from "@/lib/hooks/use-api-resource";
import { useNeighbourhoods } from "@/components/providers/neighbourhood-provider";
import {
  formatCurrency,
  formatDays,
  formatPercent,
  formatSignedPercent,
} from "@/lib/calculations/format";
import { Stack } from "@/components/ui/section";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Select } from "@/components/ui/select";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { ConditionBadge } from "@/components/ui/badge";
import { RowHeader, Table, TableWrapper, Td, Th } from "@/components/ui/data-table";
import { EmptyState, ErrorState, Skeleton } from "@/components/ui/states";
import { ComparisonBarChart } from "@/components/charts/comparison-bar-chart";
import { DemoDataNotice } from "@/components/data/source-badge";

const MAX_SELECTION = 4;

/** Metrics the comparison table shows, in display order. */
const METRICS = [
  {
    key: "medianCondoPrice",
    label: copy.metrics.medianCondoPrice.label,
    unit: "currency" as const,
    format: (row: ComparisonRow) => formatCurrency(row.medianCondoPrice),
    value: (row: ComparisonRow) => row.medianCondoPrice,
  },
  {
    key: "pricePerSqFt",
    label: copy.metrics.pricePerSqFt.label,
    unit: "currency" as const,
    format: (row: ComparisonRow) => formatCurrency(row.pricePerSqFt),
    value: (row: ComparisonRow) => row.pricePerSqFt,
  },
  {
    key: "oneBedroomRent",
    label: copy.metrics.averageOneBedroomRent.label,
    unit: "currency" as const,
    format: (row: ComparisonRow) => formatCurrency(row.oneBedroomRent),
    value: (row: ComparisonRow) => row.oneBedroomRent,
  },
  {
    key: "twoBedroomRent",
    label: copy.metrics.averageTwoBedroomRent.label,
    unit: "currency" as const,
    format: (row: ComparisonRow) => formatCurrency(row.twoBedroomRent),
    value: (row: ComparisonRow) => row.twoBedroomRent,
  },
  {
    key: "vacancyRate",
    label: copy.metrics.vacancyRate.label,
    unit: "percent" as const,
    format: (row: ComparisonRow) => formatPercent(row.vacancyRate),
    value: (row: ComparisonRow) => row.vacancyRate,
  },
  {
    key: "averageDaysOnMarket",
    label: copy.metrics.averageDaysOnMarket.label,
    unit: "count" as const,
    format: (row: ComparisonRow) => formatDays(row.averageDaysOnMarket),
    value: (row: ComparisonRow) => row.averageDaysOnMarket,
  },
  {
    key: "priceYoyChange",
    label: "Year-over-year price change",
    unit: "percent" as const,
    format: (row: ComparisonRow) => formatSignedPercent(row.priceYoyChange),
    value: (row: ComparisonRow) => row.priceYoyChange,
  },
  {
    key: "rentYoyChange",
    label: "Year-over-year rent change",
    unit: "percent" as const,
    format: (row: ComparisonRow) => formatSignedPercent(row.rentYoyChange),
    value: (row: ComparisonRow) => row.rentYoyChange,
  },
];

/**
 * Side-by-side neighbourhood comparison.
 *
 * The table is transposed from the obvious layout — metrics run down the rows,
 * neighbourhoods across the columns — because a comparison is read by scanning one
 * measure across places. It also means adding a fourth neighbourhood adds a column
 * rather than pushing the table taller, and the metric column stays pinned while
 * the rest scrolls on a phone.
 */
export function CompareTool() {
  const { neighbourhoods } = useNeighbourhoods();
  const [selected, setSelected] = useState<string[]>(() =>
    ["plateau-mont-royal", "rosemont-la-petite-patrie", "verdun"].filter((slug) =>
      neighbourhoods.some((entry) => entry.slug === slug),
    ),
  );
  const [chartMetric, setChartMetric] = useState(METRICS[0].key);

  const key = selected.length > 0 ? `compare:${selected.join(",")}` : null;
  const fetcher = useCallback(
    (signal: AbortSignal) => api.compare(selected, signal),
    [selected],
  );
  const resource = useApiResource<ComparisonRow[]>(key, fetcher);

  const remaining = neighbourhoods.filter((entry) => !selected.includes(entry.slug));
  const atLimit = selected.length >= MAX_SELECTION;

  const activeMetric = METRICS.find((metric) => metric.key === chartMetric) ?? METRICS[0];

  return (
    <Stack>
      <Card>
        <CardHeader
          title="Neighbourhoods to compare"
          description={
            atLimit
              ? copy.comparePage.limitReached
              : "Add up to four. Remove one by selecting its chip."
          }
        />
        <CardBody>
          <div className="flex flex-wrap items-end gap-3">
            <Select
              label={copy.comparePage.addNeighbourhood}
              hideLabel
              value=""
              placeholder={
                atLimit ? copy.comparePage.limitReached : copy.selector.placeholder
              }
              onChange={(slug) => {
                if (!slug || atLimit) return;
                setSelected((current) => [...current, slug]);
              }}
              options={
                atLimit
                  ? []
                  : remaining.map((entry) => ({ value: entry.slug, label: entry.name }))
              }
              className="min-w-[14rem]"
            />

            <ul className="flex flex-wrap gap-2">
              {selected.map((slug) => {
                const neighbourhood = neighbourhoods.find((entry) => entry.slug === slug);
                return (
                  <li key={slug}>
                    <button
                      type="button"
                      onClick={() =>
                        setSelected((current) => current.filter((entry) => entry !== slug))
                      }
                      className="inline-flex items-center gap-2 rounded-md border border-line-strong bg-surface px-2.5 py-1.5 text-[0.8125rem] font-medium text-ink transition-colors hover:border-critical hover:text-critical-ink"
                    >
                      {neighbourhood?.name ?? slug}
                      <span aria-hidden="true">×</span>
                      <span className="sr-only">
                        {copy.comparePage.remove} {neighbourhood?.name ?? slug}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        </CardBody>
      </Card>

      {selected.length === 0 ? (
        <EmptyState
          title={copy.comparePage.emptyTitle}
          body={copy.comparePage.emptyBody}
        />
      ) : resource.status === "error" ? (
        <ErrorState message={resource.error} onRetry={resource.reload} />
      ) : resource.isInitialLoading || !resource.data ? (
        <Skeleton className="h-96 w-full" />
      ) : (
        <>
          <Card>
            <CardHeader title="Side by side" />
            <CardBody>
              <TableWrapper label={copy.comparePage.title}>
                <Table>
                  <thead>
                    <tr>
                      <Th sticky>{copy.comparePage.metricColumn}</Th>
                      {resource.data.map((row) => (
                        <Th key={row.slug} numeric>
                          {row.name}
                        </Th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {METRICS.map((metric) => (
                      <tr key={metric.key}>
                        <RowHeader>{metric.label}</RowHeader>
                        {resource.data!.map((row) => (
                          <Td key={row.slug} numeric>
                            {metric.format(row)}
                          </Td>
                        ))}
                      </tr>
                    ))}
                    <tr>
                      <RowHeader>{copy.conditions.scoreLabel}</RowHeader>
                      {resource.data.map((row) => (
                        <Td key={row.slug} numeric>
                          <ConditionBadge condition={row.condition} />
                        </Td>
                      ))}
                    </tr>
                  </tbody>
                </Table>
              </TableWrapper>
            </CardBody>
          </Card>

          <Card>
            <CardHeader
              title={activeMetric.label}
              actions={
                <SegmentedControl
                  size="sm"
                  label="Metric to chart"
                  value={chartMetric}
                  onChange={setChartMetric}
                  options={METRICS.slice(0, 4).map((metric) => ({
                    value: metric.key,
                    label: metric.label,
                  }))}
                />
              }
            />
            <CardBody>
              <ComparisonBarChart
                unit={activeMetric.unit}
                data={resource.data.map((row) => ({
                  label: row.name,
                  value: activeMetric.value(row),
                }))}
              />
            </CardBody>
          </Card>

          <DemoDataNotice />
        </>
      )}
    </Stack>
  );
}
