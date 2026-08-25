import type { NeighbourhoodSnapshot, PropertyType } from "@/types";
import { PROPERTY_TYPES } from "@/types";
import { copy } from "@/lib/i18n";
import {
  formatCurrency,
  formatDays,
  formatNumber,
} from "@/lib/calculations/format";
import { Section } from "@/components/ui/section";
import { StatCard, StatGrid } from "@/components/ui/stat-card";

const PRICE_METRIC_BY_TYPE = {
  condo: copy.metrics.medianCondoPrice,
  house: copy.metrics.medianHousePrice,
  plex: copy.metrics.medianPlexPrice,
} satisfies Record<PropertyType, { label: string; description: string }>;

/**
 * The sale-side headline figures.
 *
 * Where a neighbourhood has no meaningful stock of a property type, the card
 * renders an em dash and says why. Interpolating a plausible-looking number for
 * Griffintown's non-existent detached houses would be the easy thing and the wrong
 * one.
 */
export function MarketOverview({ snapshot }: { snapshot: NeighbourhoodSnapshot }) {
  const condo = snapshot.sale.condo;
  const lead = snapshot.sale[snapshot.availablePropertyTypes[0]];

  const totalInventory = PROPERTY_TYPES.reduce(
    (total, type) => total + (snapshot.sale[type]?.activeListings ?? 0),
    0,
  );

  return (
    <Section title={copy.neighbourhoodsPage.overviewTitle}>
      <StatGrid columns={3}>
        {PROPERTY_TYPES.map((type) => {
          const stat = snapshot.sale[type];
          const metric = PRICE_METRIC_BY_TYPE[type];

          return (
            <StatCard
              key={type}
              label={metric.label}
              hint={metric.description}
              value={stat ? formatCurrency(stat.medianPrice) : "—"}
              change={stat ? stat.yearOverYearChange : undefined}
              footnote={stat ? undefined : copy.states.noPropertyType}
            />
          );
        })}

        <StatCard
          label={copy.metrics.pricePerSqFt.label}
          hint={copy.metrics.pricePerSqFt.description}
          value={condo ? formatCurrency(condo.averagePricePerSqFt) : "—"}
          footnote={
            condo
              ? `${copy.propertyTypesPlural.condo}, ${snapshot.period}`
              : copy.states.noPropertyType
          }
        />

        <StatCard
          label={copy.metrics.averageDaysOnMarket.label}
          hint={copy.metrics.averageDaysOnMarket.description}
          value={lead ? formatDays(lead.averageDaysOnMarket) : "—"}
          footnote={
            lead
              ? `${copy.propertyTypesPlural[lead.propertyType]} — the largest segment here`
              : undefined
          }
        />

        <StatCard
          label={copy.metrics.inventory.label}
          hint={copy.metrics.inventory.description}
          value={formatNumber(totalInventory)}
          footnote="Active listings across all tracked property types."
        />
      </StatGrid>
    </Section>
  );
}
