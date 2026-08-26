import type { Metadata } from "next";
import { copy } from "@/lib/i18n";
import { Container, PageHeader, Stack } from "@/components/ui/section";
import { DemoDataNotice } from "@/components/data/source-badge";
import { BuildingActivity } from "@/components/civic/building-activity";
import { BuyDashboard } from "./buy-dashboard";

export const metadata: Metadata = {
  title: copy.buyPage.title,
  description: copy.buyPage.subtitle,
};

export default function BuyPage() {
  return (
    <Container className="py-10 sm:py-12">
      <Stack className="animate-rise">
        <PageHeader title={copy.buyPage.title} description={copy.buyPage.subtitle} />
        <DemoDataNotice />
        <BuyDashboard />

        {/* City-wide supply. On a page about buying, "how much is being built"
            is the counterweight to every price on it — and it is the one figure
            here that comes from a municipal record rather than a market
            estimate. No place is named, so this is the whole island. */}
        <BuildingActivity title={copy.permits.cityTitle} />
      </Stack>
    </Container>
  );
}
