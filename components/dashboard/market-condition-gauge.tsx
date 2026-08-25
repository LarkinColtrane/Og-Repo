import type { MarketCondition } from "@/types";
import { copy } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { formatDays, formatNumber, formatPercent } from "@/lib/calculations/format";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { ConditionBadge } from "@/components/ui/badge";
import { DerivedNote } from "@/components/data/source-badge";

/**
 * The market-condition classification, with its working shown.
 *
 * Rendered as a **position on a scale**, not a filled meter: buyer's and seller's
 * are opposite ends of one axis rather than more and less of a quantity, and a
 * progress bar would imply the second thing. Each contributing factor is listed
 * with its measured value and its weight, so a reader who disagrees with the
 * weighting can see exactly what they are disagreeing with.
 */
export function MarketConditionGauge({
  condition,
  className,
}: {
  condition: MarketCondition;
  className?: string;
}) {
  return (
    <Card className={className}>
      <CardHeader
        title={copy.neighbourhoodsPage.conditionTitle}
        description={copy.conditions.explainer}
        actions={<ConditionBadge condition={condition.label} />}
      />
      <CardBody>
        <Scale score={condition.score} />

        <div className="mt-6">
          <p className="eyebrow mb-3">{copy.conditions.factorsTitle}</p>
          <ul className="space-y-3">
            {condition.factors.map((factor) => (
              <li key={factor.key}>
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-[0.8125rem] text-ink-secondary">
                    {copy.conditions.factorLabels[factor.key]}
                  </span>
                  <span className="text-[0.8125rem] font-medium tabular text-ink">
                    {formatFactorValue(factor.key, factor.value)}
                  </span>
                </div>
                <div className="mt-1.5 flex items-center gap-2">
                  <div
                    className="h-1 flex-1 overflow-hidden rounded-full bg-surface-inset"
                    role="img"
                    aria-label={`${copy.conditions.factorLabels[factor.key]}: ${Math.round(factor.contribution)} out of 100 toward a seller's market`}
                  >
                    <div
                      className="h-full rounded-full bg-accent"
                      style={{ width: `${factor.contribution}%` }}
                    />
                  </div>
                  <span className="w-20 shrink-0 text-right text-[0.6875rem] whitespace-nowrap text-ink-muted">
                    {Math.round(factor.weight * 100)}% weight
                  </span>
                </div>
              </li>
            ))}
          </ul>
        </div>

        <DerivedNote className="mt-5 border-t border-line pt-3">
          Weighted from the four measures above. Thresholds are conventional rules of
          thumb from residential market analysis and are listed in
          lib/calculations/market-condition.ts — they are not calibrated against
          Montréal transaction data, because none is connected yet.
        </DerivedNote>
      </CardBody>
    </Card>
  );
}

function Scale({ score }: { score: number }) {
  return (
    <div>
      <div className="mb-2 flex items-baseline justify-between">
        <span className="text-[0.6875rem] text-ink-muted">
          {copy.conditions.scaleLow}
        </span>
        <span className="text-[1.5rem] font-semibold tracking-[-0.02em] text-ink">
          {score}
          <span className="ml-1 text-[0.8125rem] font-normal text-ink-muted">/ 100</span>
        </span>
        <span className="text-[0.6875rem] text-ink-muted">
          {copy.conditions.scaleHigh}
        </span>
      </div>

      <div
        className="relative h-2 rounded-full bg-surface-inset"
        role="img"
        aria-label={`${copy.conditions.scoreLabel}: ${score} out of 100`}
      >
        {/* Zone boundaries at 40 and 60, where the classification changes. */}
        <span className={cn("absolute top-0 bottom-0 w-px bg-line-strong")} style={{ left: "40%" }} />
        <span className={cn("absolute top-0 bottom-0 w-px bg-line-strong")} style={{ left: "60%" }} />
        <span
          className="absolute top-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-surface bg-accent shadow-card"
          style={{ left: `${score}%` }}
        />
      </div>
    </div>
  );
}

function formatFactorValue(key: string, value: number): string {
  if (key === "monthsOfInventory") return `${formatNumber(value, 1)} months`;
  if (key === "daysOnMarket") return formatDays(value);
  if (key === "listingToSaleRatio") return formatPercent(value);
  return formatPercent(value);
}
