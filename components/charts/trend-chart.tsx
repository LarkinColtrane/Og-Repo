"use client";

import { useMemo, useState, type ReactElement, type ReactNode } from "react";
import {
  CartesianGrid,
  LabelList,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { Attribution } from "@/types";
import { copy } from "@/lib/i18n";
import { formatPeriod, parsePeriod } from "@/lib/periods";
import {
  formatAxisValue,
  formatCurrency,
  formatNumber,
  formatPercent,
} from "@/lib/calculations/format";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Table, TableWrapper, Td, Th } from "@/components/ui/data-table";
import { ChartSkeleton, EmptyState } from "@/components/ui/states";
import { SourceBadge } from "@/components/data/source-badge";
import { CHART_SPEC, getChartPalette, seriesColor } from "./chart-theme";
import { useResolvedTheme } from "@/lib/hooks/use-theme";
import { useIsClient } from "@/lib/hooks/use-is-client";

export type ChartUnit = "currency" | "percent" | "count";

export interface TrendSeriesConfig {
  /** Key into each data row. */
  key: string;
  label: string;
}

export interface TrendChartRow {
  period: string;
  [key: string]: string | number | null;
}

export function formatChartValue(value: number | null | undefined, unit: ChartUnit) {
  if (value === null || value === undefined) return "—";
  if (unit === "currency") return formatCurrency(value);
  if (unit === "percent") return formatPercent(value);
  return formatNumber(value);
}

/**
 * The platform's line chart: price history, rent history, anything monthly.
 *
 * Design decisions worth knowing about:
 *
 *  - **Rendered only after mount.** The palette depends on the resolved theme,
 *    which the server cannot know. Rendering on the server and re-colouring on the
 *    client would be a hydration mismatch, so the skeleton holds the space until
 *    the browser can answer.
 *  - **Straight segments, not smoothed curves.** A monotone spline invents values
 *    between months that were never measured. With monthly data the difference is
 *    visible and it misstates the series.
 *  - **A table view sits behind every chart.** Two of the four series colours fall
 *    below 3:1 contrast on the light surface, so the data has to be reachable
 *    without relying on colour — and it makes the underlying numbers copyable.
 */
export function TrendChart({
  title,
  description,
  series,
  data,
  unit,
  actions,
  sources,
  height = CHART_SPEC.height,
  emptyMessage,
  className,
  formatAxisLabel = formatTick,
  formatPointLabel = (key: string) => formatPeriod(key),
}: {
  title: string;
  description?: ReactNode;
  series: TrendSeriesConfig[];
  data: TrendChartRow[];
  unit: ChartUnit;
  /** Filter controls rendered in the card header. */
  actions?: ReactNode;
  sources?: Attribution[];
  height?: number;
  emptyMessage?: string;
  className?: string;
  /**
   * How to label an axis tick. Defaults to the monthly `YYYY-MM` treatment.
   *
   * Supplied by the daily benchmark chart, whose keys are `YYYY-MM-DD` and would
   * otherwise be handed to a month parser that rejects them. Making the key
   * opaque to this component is what lets one chart serve both cadences.
   */
  formatAxisLabel?: (key: string) => string;
  /** How to label a point in the tooltip and the table. Defaults to monthly. */
  formatPointLabel?: (key: string) => string;
}) {
  const theme = useResolvedTheme();
  const palette = getChartPalette(theme);
  const [view, setView] = useState<"chart" | "table">("chart");
  const mounted = useIsClient();

  const colours = useMemo(
    () => series.map((_, index) => seriesColor(palette, index)),
    [series, palette],
  );

  const hasData = data.length > 0 && series.length > 0;

  return (
    <Card className={className}>
      <CardHeader
        title={title}
        description={description}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {actions}
            <SegmentedControl
              size="sm"
              label={`${title} view`}
              value={view}
              onChange={setView}
              options={[
                { value: "chart", label: copy.actions.showChart },
                { value: "table", label: copy.actions.showTable },
              ]}
            />
          </div>
        }
      />

      <CardBody>
        {!hasData ? (
          <EmptyState body={emptyMessage ?? copy.states.emptyBody} />
        ) : !mounted ? (
          <ChartSkeleton height={height} />
        ) : view === "table" ? (
          <SeriesTable
            series={series}
            data={data}
            unit={unit}
            colours={colours}
            formatPointLabel={formatPointLabel}
          />
        ) : (
          <>
            {series.length > 1 ? (
              <Legend series={series} colours={colours} />
            ) : null}
            <div style={{ height }} className="mt-1 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart
                  data={data}
                  margin={{
                    // Room for the end-label on a single-series chart. Too little
                    // and the last digits are clipped by the plot edge.
                    top: 8,
                    right: series.length === 1 ? 84 : 12,
                    bottom: 0,
                    left: 0,
                  }}
                >
                  <CartesianGrid
                    vertical={false}
                    stroke={palette.grid}
                    strokeWidth={1}
                  />
                  <XAxis
                    dataKey="period"
                    tickFormatter={formatAxisLabel}
                    tickLine={false}
                    axisLine={{ stroke: palette.axis }}
                    tick={{ fill: palette.tickText, fontSize: 11 }}
                    minTickGap={44}
                    interval="preserveStartEnd"
                    dy={6}
                  />
                  <YAxis
                    tickFormatter={(value: number) => formatAxisValue(value, unit)}
                    tickLine={false}
                    axisLine={false}
                    tick={{ fill: palette.tickText, fontSize: 11 }}
                    width={64}
                    domain={["auto", "auto"]}
                  />
                  <Tooltip
                    cursor={{ stroke: palette.crosshair, strokeWidth: 1 }}
                    content={
                      <TrendTooltip
                        series={series}
                        colours={colours}
                        unit={unit}
                        formatPointLabel={formatPointLabel}
                      />
                    }
                  />
                  {series.map((entry, index) => (
                    <Line
                      key={entry.key}
                      type="linear"
                      dataKey={entry.key}
                      name={entry.label}
                      stroke={colours[index]}
                      strokeWidth={CHART_SPEC.lineWidth}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      dot={false}
                      isAnimationActive={false}
                      activeDot={{
                        r: CHART_SPEC.activeDotRadius,
                        fill: colours[index],
                        stroke: palette.surface,
                        strokeWidth: CHART_SPEC.activeDotRingWidth,
                      }}
                      connectNulls
                    >
                      {/* A single series gets its final value labelled directly.
                          With several, converging end-labels read as noise, so the
                          legend and tooltip carry identity instead. */}
                      {series.length === 1 ? (
                        <LabelList
                          dataKey={entry.key}
                          content={(props: unknown) =>
                            renderEndLabel(props, data.length, unit, colours[index])
                          }
                        />
                      ) : null}
                    </Line>
                  ))}
                </LineChart>
              </ResponsiveContainer>
            </div>
          </>
        )}

        {sources && sources.length > 0 ? (
          <div className="mt-4 border-t border-line pt-3">
            <SourceBadge sources={sources} />
          </div>
        ) : null}
      </CardBody>
    </Card>
  );
}

function formatTick(period: string): string {
  const { year, month } = parsePeriod(period);
  // Only January carries the year, so the axis reads as a timeline rather than a
  // wall of repeated numbers.
  return month === 1
    ? `${formatPeriod(period, { withYear: false })} ${String(year).slice(2)}`
    : formatPeriod(period, { withYear: false });
}

function Legend({
  series,
  colours,
}: {
  series: TrendSeriesConfig[];
  colours: string[];
}) {
  return (
    <ul
      aria-label={copy.chart.legendLabel}
      className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1.5"
    >
      {series.map((entry, index) => (
        <li key={entry.key} className="flex items-center gap-1.5">
          <span
            aria-hidden="true"
            className="inline-block h-0.5 w-4 rounded-full"
            style={{ backgroundColor: colours[index] }}
          />
          <span className="text-[0.75rem] text-ink-secondary">{entry.label}</span>
        </li>
      ))}
    </ul>
  );
}

interface TooltipPayloadEntry {
  dataKey?: string | number;
  value?: number;
}

function TrendTooltip({
  active,
  payload,
  label,
  series,
  colours,
  unit,
  formatPointLabel,
}: {
  active?: boolean;
  payload?: TooltipPayloadEntry[];
  label?: string;
  series: TrendSeriesConfig[];
  colours: string[];
  unit: ChartUnit;
  formatPointLabel: (key: string) => string;
}) {
  if (!active || !payload || payload.length === 0 || !label) return null;

  return (
    <div className="rounded-md border border-line bg-surface px-3 py-2 shadow-raised">
      <p className="mb-1.5 text-[0.6875rem] font-semibold tracking-[0.04em] text-ink-muted uppercase">
        {formatPointLabel(label)}
      </p>
      <ul className="space-y-1">
        {series.map((entry, index) => {
          const point = payload.find((item) => item.dataKey === entry.key);
          if (!point || point.value === undefined || point.value === null) return null;
          return (
            <li key={entry.key} className="flex items-center gap-2 text-[0.8125rem]">
              <span
                aria-hidden="true"
                className="inline-block h-0.5 w-3 shrink-0 rounded-full"
                style={{ backgroundColor: colours[index] }}
              />
              <span className="text-ink-secondary">{entry.label}</span>
              <span className="ml-auto pl-3 font-medium tabular text-ink">
                {formatChartValue(point.value, unit)}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/**
 * Value label on the final point of a single-series chart. Recharts' label
 * renderer must return an element, so points that get no label return an empty
 * `<g>` rather than null.
 */
function renderEndLabel(
  props: unknown,
  length: number,
  unit: ChartUnit,
  colour: string,
): ReactElement {
  const { index, x, y, value } = props as {
    index?: number;
    x?: number;
    y?: number;
    value?: number;
  };
  if (index !== length - 1 || x === undefined || y === undefined) return <g />;

  return (
    <text
      x={x + 8}
      y={y}
      dy={4}
      fill={colour}
      fontSize={11}
      fontWeight={600}
      textAnchor="start"
    >
      {formatChartValue(value, unit)}
    </text>
  );
}

function SeriesTable({
  series,
  data,
  unit,
  colours,
  formatPointLabel,
}: {
  series: TrendSeriesConfig[];
  data: TrendChartRow[];
  unit: ChartUnit;
  colours: string[];
  formatPointLabel: (key: string) => string;
}) {
  // Newest first: the recent end of a series is what a reader scans for.
  const rows = [...data].reverse();

  return (
    <TableWrapper label={copy.chart.tableViewLabel} className="max-h-[420px] overflow-y-auto">
      <Table>
        <thead>
          <tr>
            <Th sticky>{copy.chart.periodColumn}</Th>
            {series.map((entry, index) => (
              <Th key={entry.key} numeric>
                <span className="inline-flex items-center gap-1.5">
                  <span
                    aria-hidden="true"
                    className="inline-block h-0.5 w-3 rounded-full"
                    style={{ backgroundColor: colours[index] }}
                  />
                  {entry.label}
                </span>
              </Th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.period}>
              <Td sticky>{formatPointLabel(row.period)}</Td>
              {series.map((entry) => (
                <Td key={entry.key} numeric>
                  {formatChartValue(row[entry.key] as number | null, unit)}
                </Td>
              ))}
            </tr>
          ))}
        </tbody>
      </Table>
    </TableWrapper>
  );
}
