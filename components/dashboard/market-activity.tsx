import type { NeighbourhoodSnapshot, SaleMarketStat } from "@/types";
import { PROPERTY_TYPES } from "@/types";
import { copy } from "@/lib/i18n";
import { formatDays, formatNumber, formatPercent } from "@/lib/calculations/format";
import { monthsOfInventory } from "@/lib/calculations/market-condition";
import { Section } from "@/components/ui/section";
import { StatCard, StatGrid } from "@/components/ui/stat-card";
import { DerivedNote } from "@/components/data/source-badge";

/**
 * Transaction volumes for the latest month, rolled up across property types.
 *
 * Days on market and sale-to-list ratio are averaged **weighted by sales count**,
 * not straight averages: four house sales and sixty plex sales should not count
 * equally toward a neighbourhood-wide figure.
 */
export function MarketActivity({ snapshot }: { snapshot: NeighbourhoodSnapshot }) {
  const stats = PROPERTY_TYPES.map((type) => snapshot.sale[type]).filter(
    (stat): stat is SaleMarketStat => stat !== undefined,
  );

  const totalSales = stats.reduce((total, stat) => total + stat.salesCount, 0);
  const totalActive = stats.reduce((total, stat) => total + stat.activeListings, 0);
  const totalNew = stats.reduce((total, stat) => total + stat.newListings, 0);

  const weighted = (pick: (stat: SaleMarketStat) => number) =>
    totalSales > 0
      ? stats.reduce((total, stat) => total + pick(stat) * stat.salesCount, 0) / totalSales
      : 0;

  const averageDaysOnMarket = weighted((stat) => stat.averageDaysOnMarket);
  const listingToSaleRatio = weighted((stat) => stat.listingToSaleRatio);
  const inventoryMonths = monthsOfInventory(totalActive, totalSales);

  return (
    <Section title={copy.neighbourhoodsPage.activityTitle}>
      <StatGrid columns={3}>
        <StatCard
          label={copy.metrics.newListings.label}
          hint={copy.metrics.newListings.description}
          value={formatNumber(totalNew)}
        />
        <StatCard
          label={copy.metrics.activeListings.label}
          hint={copy.metrics.activeListings.description}
          value={formatNumber(totalActive)}
        />
        <StatCard
          label={copy.metrics.salesCount.label}
          hint={copy.metrics.salesCount.description}
          value={formatNumber(totalSales)}
        />
        <StatCard
          label={copy.metrics.averageDaysOnMarket.label}
          hint={copy.metrics.averageDaysOnMarket.description}
          value={formatDays(averageDaysOnMarket)}
        />
        <StatCard
          label={copy.metrics.listingToSaleRatio.label}
          hint={copy.metrics.listingToSaleRatio.description}
          value={formatPercent(listingToSaleRatio)}
        />
        <StatCard
          label={copy.metrics.monthsOfInventory.label}
          hint={copy.metrics.monthsOfInventory.description}
          value={`${formatNumber(inventoryMonths, 1)} months`}
        />
      </StatGrid>

      <DerivedNote className="mt-4">
        Months of inventory is active listings divided by monthly sales. Days on
        market and sale-to-list ratio are averaged across property types, weighted
        by sales volume.
      </DerivedNote>
    </Section>
  );
}
