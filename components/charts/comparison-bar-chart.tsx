"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  LabelList,
  ResponsiveContainer,
  XAxis,
  YAxis,
} from "recharts";
import { formatAxisValue } from "@/lib/calculations/format";
import { ChartSkeleton, EmptyState } from "@/components/ui/states";
import { CHART_SPEC, getChartPalette } from "./chart-theme";
import { useResolvedTheme } from "@/lib/hooks/use-theme";
import { useIsClient } from "@/lib/hooks/use-is-client";
import { formatChartValue, type ChartUnit } from "./trend-chart";

export interface ComparisonDatum {
  label: string;
  value: number | null;
}

/**
 * Horizontal bars comparing several places on **one** measure.
 *
 * One measure means one colour: the bars are categories, not series, so colouring
 * them differently would imply an identity encoding that is not there. Values are
 * labelled at the tips, which makes the axis nearly redundant — so it stays
 * recessive rather than competing.
 */
export function ComparisonBarChart({
  data,
  unit,
  height,
}: {
  data: ComparisonDatum[];
  unit: ChartUnit;
  height?: number;
}) {
  const theme = useResolvedTheme();
  const palette = getChartPalette(theme);
  const mounted = useIsClient();

  const usable = data.filter(
    (entry): entry is { label: string; value: number } => entry.value !== null,
  );

  // Enough room per bar for the mark plus air on both sides.
  const chartHeight = height ?? Math.max(140, usable.length * 44 + 24);

  if (usable.length === 0) return <EmptyState />;
  if (!mounted) return <ChartSkeleton height={chartHeight} />;

  return (
    <div style={{ height: chartHeight }} className="w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          data={usable}
          layout="vertical"
          margin={{ top: 4, right: 72, bottom: 0, left: 0 }}
          barCategoryGap={12}
        >
          <CartesianGrid horizontal={false} stroke={palette.grid} strokeWidth={1} />
          <XAxis
            type="number"
            // Anchor the scale to the data rather than a rounded-up default, so the
            // longest bar reaches the plot edge instead of stopping short of it.
            domain={[0, "dataMax"]}
            tickFormatter={(value: number) => formatAxisValue(value, unit)}
            tickLine={false}
            axisLine={{ stroke: palette.axis }}
            tick={{ fill: palette.tickText, fontSize: 11 }}
          />
          <YAxis
            type="category"
            dataKey="label"
            tickLine={false}
            axisLine={false}
            tick={{ fill: palette.tickText, fontSize: 11 }}
            width={132}
          />
          <Bar
            dataKey="value"
            fill={palette.series[0]}
            maxBarSize={CHART_SPEC.barMaxWidth}
            radius={[0, CHART_SPEC.barRadius, CHART_SPEC.barRadius, 0]}
            isAnimationActive={false}
          >
            <LabelList
              dataKey="value"
              position="right"
              offset={8}
              formatter={(value: unknown) => formatChartValue(Number(value), unit)}
              style={{ fill: palette.tickText, fontSize: 11, fontWeight: 600 }}
            />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
