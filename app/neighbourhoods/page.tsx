import type { Metadata } from "next";
import Link from "next/link";
import { getRepository, getAttributions } from "@/lib/data";
import { copy } from "@/lib/i18n";
import { formatCurrency, formatDays, formatPercent } from "@/lib/calculations/format";
import { DEMO_RENT_SOURCE_ID, DEMO_SALE_SOURCE_ID } from "@/data/demo/sources";
import { Container, PageHeader, Stack } from "@/components/ui/section";
import { Card, CardBody } from "@/components/ui/card";
import { ConditionBadge } from "@/components/ui/badge";
import { Delta } from "@/components/ui/delta";
import { DemoDataNotice, SourceBadge } from "@/components/data/source-badge";

export const metadata: Metadata = {
  title: copy.neighbourhoodsPage.title,
  description: copy.neighbourhoodsPage.subtitle,
};

export default async function NeighbourhoodsIndex() {
  const repository = getRepository();
  const neighbourhoods = await repository.listNeighbourhoods();
  const rows = await repository.getComparison(
    neighbourhoods.map((entry) => entry.slug),
  );

  const sources = getAttributions([DEMO_SALE_SOURCE_ID, DEMO_RENT_SOURCE_ID]);

  return (
    <Container className="py-10 sm:py-12">
      <Stack className="animate-rise">
        <PageHeader
          title={copy.neighbourhoodsPage.title}
          description={copy.neighbourhoodsPage.subtitle}
        />

        <DemoDataNotice />

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4 lg:grid-cols-3">
          {rows.map((row) => {
            const neighbourhood = neighbourhoods.find(
              (entry) => entry.slug === row.slug,
            );

            return (
              <Link key={row.slug} href={`/neighbourhoods/${row.slug}`} className="group">
                <Card className="h-full transition-colors group-hover:border-accent-line">
                  <CardBody>
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <h2 className="truncate text-[1rem] font-semibold tracking-[-0.015em] text-ink">
                          {row.name}
                        </h2>
                        <p className="mt-0.5 truncate text-[0.75rem] text-ink-muted">
                          {neighbourhood?.borough}
                        </p>
                      </div>
                      <ConditionBadge condition={row.condition} />
                    </div>

                    <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3">
                      <Metric
                        label={copy.metrics.medianCondoPrice.label}
                        value={formatCurrency(row.medianCondoPrice)}
                        change={row.priceYoyChange}
                      />
                      <Metric
                        label={copy.metrics.averageTwoBedroomRent.label}
                        value={formatCurrency(row.twoBedroomRent)}
                        change={row.rentYoyChange}
                      />
                      <Metric
                        label={copy.metrics.vacancyRate.label}
                        value={formatPercent(row.vacancyRate)}
                      />
                      <Metric
                        label={copy.metrics.averageDaysOnMarket.label}
                        value={formatDays(row.averageDaysOnMarket)}
                      />
                    </dl>
                  </CardBody>
                </Card>
              </Link>
            );
          })}
        </div>

        <SourceBadge sources={sources} />
      </Stack>
    </Container>
  );
}

function Metric({
  label,
  value,
  change,
}: {
  label: string;
  value: string;
  change?: number | null;
}) {
  return (
    <div className="min-w-0">
      <dt className="truncate text-[0.6875rem] tracking-[0.04em] text-ink-muted uppercase">
        {label}
      </dt>
      <dd className="mt-1">
        <span className="block text-[1rem] font-semibold tracking-[-0.015em] tabular text-ink">
          {value}
        </span>
        {change !== undefined ? (
          <Delta value={change} className="mt-0.5" />
        ) : null}
      </dd>
    </div>
  );
}
