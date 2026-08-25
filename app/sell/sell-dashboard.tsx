"use client";

import { useCallback } from "react";
import type { NeighbourhoodSnapshot, SaleMarketStat } from "@/types";
import { PROPERTY_TYPES } from "@/types";
import { copy } from "@/lib/i18n";
import { api } from "@/lib/api/client";
import { useApiResource } from "@/lib/hooks/use-api-resource";
import { useNeighbourhoods } from "@/components/providers/neighbourhood-provider";
import {
  formatCurrency,
  formatDays,
  formatNumber,
  formatPercent,
} from "@/lib/calculations/format";
import { monthsOfInventory } from "@/lib/calculations/market-condition";
import { buildSellerGuidance } from "@/lib/calculations/summary";
import { Section, Stack } from "@/components/ui/section";
import { StatCard, StatGrid } from "@/components/ui/stat-card";
import { NeighbourhoodSelector } from "@/components/layout/neighbourhood-selector";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { ErrorState, StatCardSkeleton } from "@/components/ui/states";
import { MarketConditionGauge } from "@/components/dashboard/market-condition-gauge";
import { PriceTrends } from "@/components/dashboard/price-trends";

/**
 * Seller-facing dashboard.
 *
 * The guidance text is generated from the same measures shown above it (see
 * `buildSellerGuidance`) and is phrased as what the indicators suggest about the
 * market, never as what a property will fetch. There is no estimated sale price
 * anywhere on this page, and there should not be one until real comparable-sales
 * data exists to compute it from.
 */
export function SellDashboard() {
  const { selectedSlug, selected } = useNeighbourhoods();

  const fetcher = useCallback(
    (signal: AbortSignal) => api.snapshot(selectedSlug, signal),
    [selectedSlug],
  );

  const resource = useApiResource<NeighbourhoodSnapshot>(
    selectedSlug ? `snapshot:${selectedSlug}` : null,
    fetcher,
  );

  if (resource.status === "error") {
    return (
      <Stack>
        <NeighbourhoodSelector />
        <ErrorState message={resource.error} onRetry={resource.reload} />
      </Stack>
    );
  }

  if (resource.isInitialLoading || !resource.data) {
    return (
      <Stack>
        <NeighbourhoodSelector />
        <StatGrid columns={3}>
          <StatCardSkeleton />
          <StatCardSkeleton />
          <StatCardSkeleton />
        </StatGrid>
      </Stack>
    );
  }

  const snapshot = resource.data;
  const stats = PROPERTY_TYPES.map((type) => snapshot.sale[type]).filter(
    (stat): stat is SaleMarketStat => stat !== undefined,
  );

  const lead = snapshot.sale[snapshot.availablePropertyTypes[0]];
  const totalSales = stats.reduce((total, stat) => total + stat.salesCount, 0);
  const totalActive = stats.reduce((total, stat) => total + stat.activeListings, 0);
  const weightedRatio =
    totalSales > 0
      ? stats.reduce((total, stat) => total + stat.listingToSaleRatio * stat.salesCount, 0) /
        totalSales
      : 0;
  const weightedDays =
    totalSales > 0
      ? stats.reduce((total, stat) => total + stat.averageDaysOnMarket * stat.salesCount, 0) /
        totalSales
      : 0;
  const inventoryMonths = monthsOfInventory(totalActive, totalSales);

  const guidance = buildSellerGuidance({
    condition: snapshot.condition.label,
    averageDaysOnMarket: weightedDays,
    listingToSaleRatio: weightedRatio,
    monthsOfInventory: inventoryMonths,
  });

  return (
    <Stack>
      <NeighbourhoodSelector />

      <Section
        title={`${selected?.name ?? ""} — ${copy.sellPage.indicatorsTitle}`}
      >
        <StatGrid columns={3}>
          <StatCard
            label={copy.metrics.medianPrice.label}
            hint={copy.metrics.medianPrice.description}
            value={lead ? formatCurrency(lead.medianPrice) : "—"}
            change={lead?.yearOverYearChange}
            footnote={
              lead ? `${copy.propertyTypesPlural[lead.propertyType]} — the largest segment here` : undefined
            }
          />
          <StatCard
            label={copy.metrics.averageDaysOnMarket.label}
            hint={copy.metrics.averageDaysOnMarket.description}
            value={formatDays(weightedDays)}
          />
          <StatCard
            label={copy.metrics.activeListings.label}
            hint={copy.metrics.activeListings.description}
            value={formatNumber(totalActive)}
          />
          <StatCard
            label={copy.sellPage.recentSales}
            hint={copy.metrics.salesCount.description}
            value={formatNumber(totalSales)}
            footnote={`Completed in ${snapshot.period}.`}
          />
          <StatCard
            label={copy.metrics.listingToSaleRatio.label}
            hint={copy.metrics.listingToSaleRatio.description}
            value={formatPercent(weightedRatio)}
          />
          <StatCard
            label={copy.metrics.monthsOfInventory.label}
            hint={copy.metrics.monthsOfInventory.description}
            value={`${formatNumber(inventoryMonths, 1)} months`}
          />
        </StatGrid>
      </Section>

      <Card>
        <CardHeader
          title={copy.sellPage.interpretationTitle}
          description={copy.sellPage.disclaimer}
        />
        <CardBody>
          <ul className="space-y-4">
            {guidance.map((note) => (
              <li
                key={note}
                className="border-l-2 border-accent-line pl-4 text-[0.875rem] leading-relaxed text-ink-secondary"
              >
                {note}
              </li>
            ))}
          </ul>
        </CardBody>
      </Card>

      <MarketConditionGauge condition={snapshot.condition} />

      <PriceTrends
        slug={selectedSlug}
        availablePropertyTypes={snapshot.availablePropertyTypes}
        title={copy.sellPage.indicatorsTitle}
      />
    </Stack>
  );
}
