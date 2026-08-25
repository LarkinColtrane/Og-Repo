import type { Metadata } from "next";
import { copy } from "@/lib/i18n";
import { Container, PageHeader, Stack } from "@/components/ui/section";
import { DemoDataNotice } from "@/components/data/source-badge";
import { SellDashboard } from "./sell-dashboard";

export const metadata: Metadata = {
  title: copy.sellPage.title,
  description: copy.sellPage.subtitle,
};

export default function SellPage() {
  return (
    <Container className="py-10 sm:py-12">
      <Stack className="animate-rise">
        <PageHeader title={copy.sellPage.title} description={copy.sellPage.subtitle} />
        <DemoDataNotice />
        <SellDashboard />
      </Stack>
    </Container>
  );
}
