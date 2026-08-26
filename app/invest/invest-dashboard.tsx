"use client";

import { useCallback, useMemo } from "react";
import type { NeighbourhoodSnapshot } from "@/types";
import { api } from "@/lib/api/client";
import { useApiResource } from "@/lib/hooks/use-api-resource";
import { useNeighbourhoods } from "@/components/providers/neighbourhood-provider";
import { Stack } from "@/components/ui/section";
import { NeighbourhoodSelector } from "@/components/layout/neighbourhood-selector";
import { ErrorState, Skeleton } from "@/components/ui/states";
import { FinancingWorkspace } from "@/components/investor/financing-workspace";
import type { FormSeed } from "@/components/investor/financing-state";

/**
 * Investor page body.
 *
 * Its only job is to turn the selected neighbourhood into an opening set of
 * numbers and hand them to the financing workspace. The prefill is a
 * convenience, not something the analysis depends on — every field is editable,
 * and the arithmetic is real regardless of where the starting figures came from.
 *
 * The `key` forces a fresh workspace when the neighbourhood changes, so a new
 * prefill actually takes effect instead of being ignored as stale initial state.
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

  const snapshot = resource.data;

  const seed = useMemo<FormSeed | null>(() => {
    if (!snapshot) return null;

    // A plex is the archetypal Montréal rental purchase; fall back to whatever
    // the neighbourhood actually has.
    const stat =
      snapshot.sale.plex ??
      snapshot.sale.condo ??
      snapshot.sale[snapshot.availablePropertyTypes[0]];
    if (!stat) return null;

    const isPlex = stat.propertyType === "plex";

    // A plex is rented as several units, a condo as one. A Montréal triplex is
    // the common case, so the prefill counts three units — two two-bedrooms and
    // a one-bedroom. Counting a single unit's rent against a plex price is the
    // fastest way to make a sound property look like a disaster.
    const monthlyRent = isPlex
      ? snapshot.rent.twoBedroom.averageRent * 2 + snapshot.rent.oneBedroom.averageRent
      : snapshot.rent.twoBedroom.averageRent;

    return {
      purchasePrice: stat.medianPrice,
      monthlyRent,
      propertyType: stat.propertyType,
      units: isPlex ? 3 : 1,
    };
  }, [snapshot]);

  if (resource.status === "error") {
    return (
      <Stack>
        <NeighbourhoodSelector />
        <ErrorState message={resource.error} onRetry={resource.reload} />
      </Stack>
    );
  }

  if (resource.isInitialLoading || !seed) {
    return (
      <Stack>
        <NeighbourhoodSelector />
        <Skeleton className="h-64 w-full" />
      </Stack>
    );
  }

  return (
    <Stack>
      <NeighbourhoodSelector />
      <FinancingWorkspace
        key={selectedSlug}
        seed={seed}
        prefillNote={
          selected
            ? `Prefilled from ${selected.name} demo figures${seed.units > 1 ? `, priced as a ${seed.units}-unit plex` : ""}. Adjust anything.`
            : undefined
        }
      />
    </Stack>
  );
}
