import type { NeighbourhoodSnapshot } from "@/types";
import { BEDROOM_TYPES } from "@/types";
import { copy } from "@/lib/i18n";
import { formatCurrency, formatPercent, formatSignedPercent } from "@/lib/calculations/format";
import { Section } from "@/components/ui/section";
import { StatCard, StatGrid } from "@/components/ui/stat-card";

/** Rent by unit size, vacancy, and the year-over-year move in two-bedroom rent. */
export function RentalMarket({ snapshot }: { snapshot: NeighbourhoodSnapshot }) {
  const twoBedroom = snapshot.rent.twoBedroom;

  return (
    <Section title={copy.neighbourhoodsPage.rentalTitle}>
      <StatGrid columns={3}>
        {BEDROOM_TYPES.map((bedroomType) => {
          const stat = snapshot.rent[bedroomType];
          return (
            <StatCard
              key={bedroomType}
              label={`${copy.bedroomTypes[bedroomType]} average rent`}
              hint={copy.metrics.averageRent.description}
              value={formatCurrency(stat.averageRent)}
              change={stat.yearOverYearChange}
              footnote={`Median ${formatCurrency(stat.medianRent)}`}
            />
          );
        })}

        <StatCard
          label={copy.metrics.vacancyRate.label}
          hint={copy.metrics.vacancyRate.description}
          value={formatPercent(snapshot.vacancyRate)}
        />

        <StatCard
          label={copy.metrics.rentChange.label}
          hint={copy.metrics.rentChange.description}
          value={formatSignedPercent(twoBedroom.yearOverYearChange)}
          footnote={`${copy.bedroomTypes.twoBedroom}, against the same month last year.`}
        />
      </StatGrid>
    </Section>
  );
}
