"use client";

import { useCallback } from "react";
import type { NeighbourhoodSnapshot } from "@/types";
import { api } from "@/lib/api/client";
import { useApiResource } from "@/lib/hooks/use-api-resource";
import { useNeighbourhoods } from "@/components/providers/neighbourhood-provider";
import { Stack } from "@/components/ui/section";
import { NeighbourhoodSelector } from "@/components/layout/neighbourhood-selector";
import { ErrorState, Skeleton } from "@/components/ui/states";
import { InvestmentCalculator } from "@/components/calculators/investment-calculator";

/**
 * Investment analysis, prefilled from the selected neighbourhood.
 *
 * The prefill is a convenience, not an input the calculator depends on — every
 * field is editable, and the arithmetic is real regardless of where the starting
 * numbers came from. The `key` forces a fresh form when the neighbourhood changes,
 * so a new prefill actually takes effect instead of being ignored as stale initial
 * state.
 */
export function InvestDashboard() {
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
        <Skeleton className="h-64 w-full" />
      </Stack>
    );
  }

  const snapshot = resource.data;
  // A plex is the archetypal Montréal rental purchase; fall back to whatever the
  // neighbourhood actually has.
  const stat =
    snapshot.sale.plex ?? snapshot.sale.condo ?? snapshot.sale[snapshot.availablePropertyTypes[0]];

  // A plex is rented as several units, a condo as one. A Montréal triplex is the
  // common case, so the prefill counts three units — two two-bedrooms and a
  // one-bedroom. Counting only one unit's rent against a plex price is the fastest
  // way to make a sound property look like a disaster.
  const monthlyRent =
    stat?.propertyType === "plex"
      ? snapshot.rent.twoBedroom.averageRent * 2 + snapshot.rent.oneBedroom.averageRent
      : snapshot.rent.twoBedroom.averageRent;

  return (
    <Stack>
      <NeighbourhoodSelector />

      {stat ? (
        <InvestmentCalculator
          key={selectedSlug}
          defaultPrice={stat.medianPrice}
          defaultMonthlyRent={monthlyRent}
          defaultCondoFees={stat.propertyType === "condo" ? 350 : 0}
          neighbourhoodName={selected?.name}
          prefillDetail={
            stat.propertyType === "plex"
              ? "Rent assumes a three-unit plex: two two-bedrooms and a one-bedroom."
              : undefined
          }
        />
      ) : null}
    </Stack>
  );
}
