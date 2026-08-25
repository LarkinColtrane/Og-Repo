import type { Metadata } from "next";
import { copy } from "@/lib/i18n";
import { Container, PageHeader, Stack } from "@/components/ui/section";
import { CompareTool } from "./compare-tool";

export const metadata: Metadata = {
  title: copy.comparePage.title,
  description: copy.comparePage.subtitle,
};

export default function ComparePage() {
  return (
    <Container className="py-10 sm:py-12">
      <Stack className="animate-rise">
        <PageHeader
          title={copy.comparePage.title}
          description={copy.comparePage.subtitle}
        />
        <CompareTool />
      </Stack>
    </Container>
  );
}
