import Link from "next/link";
import { getRepository, getAttributions } from "@/lib/data";
import { copy, interpolate } from "@/lib/i18n";
import { formatPeriod } from "@/lib/periods";
import {
  formatCurrency,
  formatDays,
  formatNumber,
  formatPercent,
} from "@/lib/calculations/format";
import { DEMO_RENT_SOURCE_ID, DEMO_SALE_SOURCE_ID } from "@/data/demo/sources";
import { Container, Section, Stack } from "@/components/ui/section";
import { StatCard, StatGrid } from "@/components/ui/stat-card";
import { ButtonLink } from "@/components/ui/button";
import { Card, CardBody } from "@/components/ui/card";
import { DemoDataNotice, SourceBadge } from "@/components/data/source-badge";
import { MarketMap } from "@/components/maps/market-map";

/**
 * The homepage.
 *
 * A server component: it reads the repository directly rather than calling its own
 * API over HTTP, which would be a needless round trip inside the same process. The
 * interactive pages (Rent, Buy, Invest, Compare) go through the API instead —
 * both paths are deliberate, and the README explains when to reach for which.
 */
export default async function HomePage() {
  const repository = getRepository();
  const [overview, neighbourhoods] = await Promise.all([
    repository.getCityOverview(),
    repository.listNeighbourhoods(),
  ]);

  const mapMetrics = await repository.getComparison(
    neighbourhoods.map((entry) => entry.slug),
  );

  const sources = getAttributions([
    DEMO_SALE_SOURCE_ID,
    DEMO_RENT_SOURCE_ID,
    "src-derived-metrics",
  ]);

  return (
    <Container className="py-10 sm:py-14">
      <Stack className="animate-rise">
        <Hero />

        <DemoDataNotice />

        <Section
          title={copy.home.snapshotTitle}
          description={interpolate(copy.home.snapshotSubtitle, {
            period: formatPeriod(overview.period),
          })}
        >
          <StatGrid>
            <StatCard
              label={copy.metrics.medianCondoPrice.label}
              hint={copy.metrics.medianCondoPrice.description}
              value={formatCurrency(overview.medianCondoPrice)}
              change={overview.changes.medianCondoPrice}
            />
            <StatCard
              label={copy.metrics.medianHousePrice.label}
              hint={copy.metrics.medianHousePrice.description}
              value={formatCurrency(overview.medianHousePrice)}
              change={overview.changes.medianHousePrice}
            />
            <StatCard
              label={copy.metrics.medianPlexPrice.label}
              hint={copy.metrics.medianPlexPrice.description}
              value={formatCurrency(overview.medianPlexPrice)}
              change={overview.changes.medianPlexPrice}
            />
            <StatCard
              label={copy.metrics.activeListings.label}
              hint={copy.metrics.activeListings.description}
              value={formatNumber(overview.activeListings)}
              change={overview.changes.activeListings}
            />
            <StatCard
              label={copy.metrics.averageOneBedroomRent.label}
              hint={copy.metrics.averageOneBedroomRent.description}
              value={formatCurrency(overview.averageOneBedroomRent)}
              change={overview.changes.averageOneBedroomRent}
            />
            <StatCard
              label={copy.metrics.averageTwoBedroomRent.label}
              hint={copy.metrics.averageTwoBedroomRent.description}
              value={formatCurrency(overview.averageTwoBedroomRent)}
              change={overview.changes.averageTwoBedroomRent}
            />
            <StatCard
              label={copy.metrics.vacancyRate.label}
              hint={copy.metrics.vacancyRate.description}
              value={formatPercent(overview.vacancyRate)}
              change={overview.changes.vacancyRate}
              changeFormat="points"
            />
            <StatCard
              label={copy.metrics.averageDaysOnMarket.label}
              hint={copy.metrics.averageDaysOnMarket.description}
              value={formatDays(overview.averageDaysOnMarket)}
              change={overview.changes.averageDaysOnMarket}
            />
          </StatGrid>

          <div className="mt-4">
            <SourceBadge sources={sources} />
          </div>
        </Section>

        <Section
          title={copy.home.exploreTitle}
          description={copy.home.exploreSubtitle}
        >
          <MarketMap metrics={mapMetrics} />
        </Section>

        <Section title={copy.home.sectionsTitle}>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4 lg:grid-cols-4">
            <SectionCard
              href="/rent"
              title={copy.home.sections.rent.title}
              body={copy.home.sections.rent.body}
            />
            <SectionCard
              href="/buy"
              title={copy.home.sections.buy.title}
              body={copy.home.sections.buy.body}
            />
            <SectionCard
              href="/sell"
              title={copy.home.sections.sell.title}
              body={copy.home.sections.sell.body}
            />
            <SectionCard
              href="/invest"
              title={copy.home.sections.invest.title}
              body={copy.home.sections.invest.body}
            />
          </div>
        </Section>

        <AnalyzerTeaser />
      </Stack>
    </Container>
  );
}

function Hero() {
  return (
    <section className="border-b border-line pb-10">
      <p className="eyebrow">{copy.home.heroEyebrow}</p>
      <h1 className="mt-3 max-w-3xl text-[2.25rem] leading-[1.08] font-semibold tracking-[-0.03em] text-ink sm:text-[3rem] lg:text-[3.5rem]">
        {copy.brand.tagline}
      </h1>
      <p className="mt-5 max-w-2xl text-[1.0625rem] leading-relaxed text-ink-secondary">
        {copy.brand.description}
      </p>
      <div className="mt-7 flex flex-wrap gap-3">
        <ButtonLink href="/neighbourhoods" variant="primary">
          {copy.actions.exploreMarket}
        </ButtonLink>
        <ButtonLink href="/compare" variant="secondary">
          {copy.actions.compareNeighbourhoods}
        </ButtonLink>
      </div>
    </section>
  );
}

function SectionCard({
  href,
  title,
  body,
}: {
  href: string;
  title: string;
  body: string;
}) {
  return (
    <Link href={href} className="group block h-full">
      <Card className="h-full transition-colors group-hover:border-accent-line">
        <CardBody className="flex h-full flex-col">
          <h3 className="text-[1rem] font-semibold tracking-[-0.015em] text-ink">
            {title}
          </h3>
          <p className="mt-2 flex-1 text-[0.8125rem] leading-relaxed text-ink-secondary">
            {body}
          </p>
          <span className="mt-4 text-[0.8125rem] font-medium text-accent">
            {title} →
          </span>
        </CardBody>
      </Card>
    </Link>
  );
}

function AnalyzerTeaser() {
  return (
    <Card>
      <CardBody className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="max-w-2xl">
          <h3 className="text-[1rem] font-semibold tracking-[-0.015em] text-ink">
            {copy.analyzer.title}
          </h3>
          <p className="mt-2 text-[0.8125rem] leading-relaxed text-ink-secondary">
            {copy.analyzer.subtitle}
          </p>
        </div>
        <ButtonLink href="/property-analyzer" variant="secondary" className="shrink-0">
          {copy.analyzer.badge}
        </ButtonLink>
      </CardBody>
    </Card>
  );
}
