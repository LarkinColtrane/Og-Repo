import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getRepository, getAttributions } from "@/lib/data";
import { copy } from "@/lib/i18n";
import { formatPeriod } from "@/lib/periods";
import { DEMO_RENT_SOURCE_ID, DEMO_SALE_SOURCE_ID } from "@/data/demo/sources";
import { Container, PageHeader, Stack } from "@/components/ui/section";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody } from "@/components/ui/card";
import { DemoDataNotice, SourceBadge } from "@/components/data/source-badge";
import { MarketOverview } from "@/components/dashboard/market-overview";
import { RentalMarket } from "@/components/dashboard/rental-market";
import { MarketActivity } from "@/components/dashboard/market-activity";
import { MarketConditionGauge } from "@/components/dashboard/market-condition-gauge";
import { PriceTrends } from "@/components/dashboard/price-trends";
import { RentTrends } from "@/components/dashboard/rent-trends";
import { NeighbourhoodSelector } from "@/components/layout/neighbourhood-selector";

/** Pre-render every tracked neighbourhood at build time. */
export async function generateStaticParams() {
  const neighbourhoods = await getRepository().listNeighbourhoods();
  return neighbourhoods.map((entry) => ({ slug: entry.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const neighbourhood = await getRepository().getNeighbourhood(slug);
  if (!neighbourhood) return { title: copy.neighbourhoodsPage.notFoundTitle };

  return {
    title: `${neighbourhood.name} market dashboard`,
    description: neighbourhood.profile,
  };
}

export default async function NeighbourhoodDashboard({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const repository = getRepository();
  const [neighbourhood, snapshot] = await Promise.all([
    repository.getNeighbourhood(slug),
    repository.getSnapshot(slug),
  ]);

  if (!neighbourhood || !snapshot) notFound();

  const sources = getAttributions([
    DEMO_SALE_SOURCE_ID,
    DEMO_RENT_SOURCE_ID,
    "src-derived-metrics",
  ]);

  return (
    <Container className="py-10 sm:py-12">
      <Stack className="animate-rise">
        <PageHeader
          eyebrow={neighbourhood.borough}
          title={neighbourhood.name}
          description={neighbourhood.profile}
          meta={
            <>
              <Badge tone="neutral">{formatPeriod(snapshot.period)}</Badge>
              <Badge tone="neutral">
                {snapshot.availablePropertyTypes
                  .map((type) => copy.propertyTypesPlural[type])
                  .join(" · ")}
              </Badge>
            </>
          }
          actions={<NeighbourhoodSelector navigateOnChange />}
        />

        {/* The summary is generated from the statistics below it, so it cannot
            describe a market the numbers do not show. */}
        <Card>
          <CardBody>
            <p className="eyebrow mb-2">Market summary</p>
            <p className="max-w-3xl text-[0.9375rem] leading-relaxed text-ink-secondary">
              {snapshot.summary}
            </p>
            <SourceBadge sources={sources} className="mt-3" />
          </CardBody>
        </Card>

        <DemoDataNotice />

        <MarketOverview snapshot={snapshot} />

        <PriceTrends
          slug={slug}
          availablePropertyTypes={snapshot.availablePropertyTypes}
        />

        <RentalMarket snapshot={snapshot} />

        <RentTrends slug={slug} />

        <MarketActivity snapshot={snapshot} />

        <MarketConditionGauge condition={snapshot.condition} />
      </Stack>
    </Container>
  );
}
