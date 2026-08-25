import type { Metadata } from "next";
import { getRepository } from "@/lib/data";
import { copy } from "@/lib/i18n";
import { Container, PageHeader, Stack } from "@/components/ui/section";
import { DemoDataNotice } from "@/components/data/source-badge";
import { RentDashboard } from "./rent-dashboard";

export const metadata: Metadata = {
  title: copy.rentPage.title,
  description: copy.rentPage.subtitle,
};

export default async function RentPage() {
  // The city baseline is the same regardless of which neighbourhood is selected,
  // so it is fetched once here rather than on every selection change.
  const cityOverview = await getRepository().getCityOverview();

  return (
    <Container className="py-10 sm:py-12">
      <Stack className="animate-rise">
        <PageHeader title={copy.rentPage.title} description={copy.rentPage.subtitle} />
        <DemoDataNotice />
        <RentDashboard cityOverview={cityOverview} />
      </Stack>
    </Container>
  );
}
