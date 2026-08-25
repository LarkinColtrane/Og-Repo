import type { Metadata } from "next";
import { copy } from "@/lib/i18n";
import { Container, PageHeader, Stack } from "@/components/ui/section";
import { DemoDataNotice } from "@/components/data/source-badge";
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
      </Stack>
    </Container>
  );
}
