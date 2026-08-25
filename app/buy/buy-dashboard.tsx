"use client";

import { useCallback, useState } from "react";
import type { NeighbourhoodSnapshot, PropertyType } from "@/types";
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
import { Section, Stack } from "@/components/ui/section";
import { StatCard, StatGrid } from "@/components/ui/stat-card";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { NeighbourhoodSelector } from "@/components/layout/neighbourhood-selector";
import { EmptyState, ErrorState, StatCardSkeleton } from "@/components/ui/states";
import { PriceTrends } from "@/components/dashboard/price-trends";
import { AffordabilityCalculator } from "@/components/calculators/affordability-calculator";

/**
 * Buyer-facing dashboard: what a property type costs in an area, how much of it is
 * available, how fast it moves — and what carrying it would actually cost.
 */
export function BuyDashboard() {
  const { selectedSlug, selected } = useNeighbourhoods();
  const [propertyType, setPropertyType] = useState<PropertyType>("condo");

  const fetcher = useCallback(
    (signal: AbortSignal) => api.snapshot(selectedSlug, signal),
    [selectedSlug],
  );

  const resource = useApiResource<NeighbourhoodSnapshot>(
    selectedSlug ? `snapshot:${selectedSlug}` : null,
    fetcher,
  );

  const snapshot = resource.data;
  const available = snapshot?.availablePropertyTypes ?? [];

  const controls = (
    <div className="flex flex-wrap items-end gap-3">
      <NeighbourhoodSelector />
      <SegmentedControl
        label="Property type"
        value={propertyType}
        onChange={setPropertyType}
        options={(["condo", "house", "plex"] as PropertyType[]).map((type) => ({
          value: type,
          label: copy.propertyTypes[type],
          disabled: snapshot ? !available.includes(type) : false,
        }))}
      />
    </div>
  );

  if (resource.status === "error") {
    return (
      <Stack>
        {controls}
        <ErrorState message={resource.error} onRetry={resource.reload} />
      </Stack>
    );
  }

  if (resource.isInitialLoading || !snapshot) {
    return (
      <Stack>
        {controls}
        <StatGrid columns={3}>
          <StatCardSkeleton />
          <StatCardSkeleton />
          <StatCardSkeleton />
        </StatGrid>
      </Stack>
    );
  }

  const stat = snapshot.sale[propertyType];

  return (
    <Stack>
      {controls}

      {!stat ? (
        <EmptyState
          title={copy.states.noPropertyType}
          body={copy.states.noPropertyTypeBody}
        />
      ) : (
        <>
          <Section
            title={`${selected?.name ?? ""} — ${copy.propertyTypesPlural[propertyType]}`}
          >
            <StatGrid columns={3}>
              <StatCard
                label={copy.metrics.medianPrice.label}
                hint={copy.metrics.medianPrice.description}
                value={formatCurrency(stat.medianPrice)}
                change={stat.yearOverYearChange}
                size="large"
              />
              <StatCard
                label={copy.metrics.pricePerSqFt.label}
                hint={copy.metrics.pricePerSqFt.description}
                value={formatCurrency(stat.averagePricePerSqFt)}
              />
              <StatCard
                label={copy.metrics.averageDaysOnMarket.label}
                hint={copy.metrics.averageDaysOnMarket.description}
                value={formatDays(stat.averageDaysOnMarket)}
              />
              <StatCard
                label={copy.metrics.activeListings.label}
                hint={copy.metrics.activeListings.description}
                value={formatNumber(stat.activeListings)}
              />
              <StatCard
                label={copy.metrics.monthsOfInventory.label}
                hint={copy.metrics.monthsOfInventory.description}
                value={`${formatNumber(monthsOfInventory(stat.activeListings, stat.salesCount), 1)} months`}
              />
              <StatCard
                label={copy.metrics.listingToSaleRatio.label}
                hint={copy.metrics.listingToSaleRatio.description}
                value={formatPercent(stat.listingToSaleRatio)}
              />
            </StatGrid>
          </Section>

          {/* Controlled by this page's property-type filter, so the chart and the
              cards above it always describe the same thing. */}
          <PriceTrends
            slug={selectedSlug}
            availablePropertyTypes={available}
            propertyType={propertyType}
            title={copy.buyPage.priceHistoryTitle}
          />

          <AffordabilityCalculator
            key={`${selectedSlug}:${propertyType}`}
            defaultPrice={stat.medianPrice}
            defaultCondoFees={propertyType === "condo" ? 350 : 0}
            neighbourhoodName={selected?.name}
          />
        </>
      )}
    </Stack>
  );
}
