"use client";

import { useCallback, useState } from "react";
import type { BedroomType, CityOverview, NeighbourhoodSnapshot } from "@/types";
import { BEDROOM_TYPES } from "@/types";
import { copy } from "@/lib/i18n";
import { api } from "@/lib/api/client";
import { useApiResource } from "@/lib/hooks/use-api-resource";
import { useNeighbourhoods } from "@/components/providers/neighbourhood-provider";
import {
  formatCurrency,
  formatPercent,
  formatSignedPercent,
} from "@/lib/calculations/format";
import { percentChange } from "@/lib/calculations/aggregate";
import { Section, Stack } from "@/components/ui/section";
import { StatCard, StatGrid } from "@/components/ui/stat-card";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { NeighbourhoodSelector } from "@/components/layout/neighbourhood-selector";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { ErrorState, StatCardSkeleton } from "@/components/ui/states";
import { ComparisonBarChart } from "@/components/charts/comparison-bar-chart";
import { RentTrends } from "@/components/dashboard/rent-trends";
import { DerivedNote } from "@/components/data/source-badge";

/**
 * Rental intelligence for one neighbourhood and one unit size.
 *
 * The Montréal baseline arrives as a prop from the server page — it is the same
 * for every neighbourhood, so re-fetching it on each selection change would be
 * wasted work. Only the neighbourhood snapshot is fetched client-side.
 */
export function RentDashboard({ cityOverview }: { cityOverview: CityOverview }) {
  const { selectedSlug, selected } = useNeighbourhoods();
  const [bedroomType, setBedroomType] = useState<BedroomType>("twoBedroom");

  const fetcher = useCallback(
    (signal: AbortSignal) => api.snapshot(selectedSlug, signal),
    [selectedSlug],
  );

  const resource = useApiResource<NeighbourhoodSnapshot>(
    selectedSlug ? `snapshot:${selectedSlug}` : null,
    fetcher,
  );

  const controls = (
    <div className="flex flex-wrap items-end gap-3">
      <NeighbourhoodSelector />
      <SegmentedControl
        label="Unit size"
        value={bedroomType}
        onChange={setBedroomType}
        options={BEDROOM_TYPES.map((type) => ({
          value: type,
          label: copy.bedroomTypes[type],
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

  if (resource.isInitialLoading || !resource.data) {
    return (
      <Stack>
        {controls}
        <StatGrid columns={4}>
          <StatCardSkeleton />
          <StatCardSkeleton />
          <StatCardSkeleton />
          <StatCardSkeleton />
        </StatGrid>
      </Stack>
    );
  }

  const snapshot = resource.data;
  const stat = snapshot.rent[bedroomType];

  // The city baseline only exists for the sizes the roll-up tracks; for studios and
  // three-bedrooms there is no published Montréal-wide figure to compare against,
  // and the comparison panel says so rather than substituting a different size.
  const cityRent =
    bedroomType === "oneBedroom"
      ? cityOverview.averageOneBedroomRent
      : bedroomType === "twoBedroom"
        ? cityOverview.averageTwoBedroomRent
        : null;

  const difference = percentChange(stat.averageRent, cityRent);

  return (
    <Stack>
      {controls}

      <Section
        title={`${selected?.name ?? ""} — ${copy.bedroomTypes[bedroomType]}`}
        description={`Latest reported month, ${snapshot.period}.`}
      >
        <StatGrid columns={4}>
          <StatCard
            label={copy.metrics.averageRent.label}
            hint={copy.metrics.averageRent.description}
            value={formatCurrency(stat.averageRent)}
            size="large"
          />
          <StatCard
            label={copy.metrics.medianRent.label}
            hint={copy.metrics.medianRent.description}
            value={formatCurrency(stat.medianRent)}
          />
          <StatCard
            label={copy.metrics.rentChange.label}
            hint={copy.metrics.rentChange.description}
            value={formatSignedPercent(stat.yearOverYearChange)}
          />
          <StatCard
            label={copy.metrics.vacancyRate.label}
            hint={copy.metrics.vacancyRate.description}
            value={formatPercent(stat.vacancyRate)}
          />
        </StatGrid>
      </Section>

      <Card>
        <CardHeader
          title={copy.rentPage.comparisonTitle}
          description={`${copy.bedroomTypes[bedroomType]} average rent, ${selected?.name ?? ""} against the Montréal-wide figure.`}
        />
        <CardBody>
          {cityRent === null ? (
            <p className="text-[0.8125rem] leading-relaxed text-ink-secondary">
              The Montréal-wide roll-up publishes one- and two-bedroom averages only,
              so there is no city baseline for {copy.bedroomTypes[bedroomType]} to
              compare against. Switch unit size to see the comparison.
            </p>
          ) : (
            <>
              <ComparisonBarChart
                unit="currency"
                data={[
                  { label: selected?.name ?? "Neighbourhood", value: stat.averageRent },
                  { label: "Montréal average", value: cityRent },
                ]}
              />
              <div className="mt-4 flex flex-wrap items-baseline gap-x-6 gap-y-2 border-t border-line pt-4">
                <Figure label={copy.rentPage.currentRent} value={formatCurrency(stat.averageRent)} />
                <Figure label={copy.rentPage.montrealAverage} value={formatCurrency(cityRent)} />
                <Figure
                  label={copy.rentPage.difference}
                  value={formatSignedPercent(difference)}
                  note={
                    difference === null
                      ? undefined
                      : Math.abs(difference) < 1
                        ? copy.rentPage.inLineWithAverage
                        : difference > 0
                          ? copy.rentPage.aboveAverage
                          : copy.rentPage.belowAverage
                  }
                />
              </div>
              <DerivedNote className="mt-3">
                The Montréal figure is a stock-weighted average of neighbourhood
                averages, not a survey of every unit in the city.
              </DerivedNote>
            </>
          )}
        </CardBody>
      </Card>

      <RentTrends slug={selectedSlug} title={copy.rentPage.trendTitle} />
    </Stack>
  );
}

function Figure({
  label,
  value,
  note,
}: {
  label: string;
  value: string;
  note?: string;
}) {
  return (
    <div>
      <p className="eyebrow">{label}</p>
      <p className="mt-1 text-[1.25rem] font-semibold tracking-[-0.02em] text-ink">
        {value}
      </p>
      {note ? <p className="text-[0.75rem] text-ink-muted">{note}</p> : null}
    </div>
  );
}
