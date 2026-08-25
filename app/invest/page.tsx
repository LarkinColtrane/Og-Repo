import type { Metadata } from "next";
import { copy } from "@/lib/i18n";
import { Container, PageHeader, Stack } from "@/components/ui/section";
import { DemoDataNotice } from "@/components/data/source-badge";
import { InvestDashboard } from "./invest-dashboard";

export const metadata: Metadata = {
  title: copy.investPage.title,
  description: copy.investPage.subtitle,
};

export default function InvestPage() {
  return (
    <Container className="py-10 sm:py-12">
      <Stack className="animate-rise">
        <PageHeader
          title={copy.investPage.title}
          description={copy.investPage.subtitle}
        />
        <DemoDataNotice />
        <InvestDashboard />
      </Stack>
    </Container>
  );
}
