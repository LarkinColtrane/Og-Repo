import type { Metadata } from "next";
import type { DataSource, ImportRunStatus } from "@/types";
import { getRepository } from "@/lib/data";
import { copy } from "@/lib/i18n";
import { formatUpdatedAt } from "@/lib/periods";
import { formatNumber } from "@/lib/calculations/format";
import { Container, PageHeader, Section, Stack } from "@/components/ui/section";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Table, TableWrapper, Td, Th } from "@/components/ui/data-table";
import { DemoDataNotice } from "@/components/data/source-badge";

export const metadata: Metadata = {
  title: copy.dataPage.title,
  description: copy.dataPage.subtitle,
};

const STATUS_TONE: Record<DataSource["status"], BadgeTone> = {
  active: "good",
  planned: "neutral",
  stale: "warning",
  error: "critical",
};

const RUN_TONE: Record<ImportRunStatus, BadgeTone> = {
  success: "good",
  running: "accent",
  partial: "warning",
  failed: "critical",
};

/**
 * The provenance page.
 *
 * It exists so the transparency claim is auditable rather than decorative: the
 * source badge on a statistic says "demo", and this page says exactly what that
 * means, what would replace it, and under what licence.
 */
export default async function DataSourcesPage() {
  const repository = getRepository();
  const [sources, importRuns] = await Promise.all([
    repository.listDataSources(),
    repository.listImportRuns(),
  ]);

  const connected = sources.filter((source) => source.status !== "planned");
  const planned = sources.filter((source) => source.status === "planned");

  return (
    <Container className="py-10 sm:py-12">
      <Stack className="animate-rise">
        <PageHeader
          title={copy.dataPage.title}
          description={copy.dataPage.subtitle}
          meta={<Badge tone="neutral">Backing store: {repository.name}</Badge>}
        />

        <DemoDataNotice />

        <Section title={copy.dataPage.connected}>
          <div className="grid grid-cols-1 gap-3 sm:gap-4 lg:grid-cols-2">
            {connected.map((source) => (
              <SourceCard key={source.id} source={source} />
            ))}
          </div>
        </Section>

        <Section
          title={copy.dataPage.planned}
          description="Identified integrations. Each has a connector shape defined in docs/DATA_PIPELINE.md but no live connection."
        >
          <div className="grid grid-cols-1 gap-3 sm:gap-4 lg:grid-cols-2">
            {planned.map((source) => (
              <SourceCard key={source.id} source={source} />
            ))}
          </div>
        </Section>

        <Card>
          <CardHeader
            title={copy.dataPage.importHistory}
            description="Every import writes a row here — the audit trail an automated pipeline needs. These runs are from the demo generator."
          />
          <CardBody>
            <TableWrapper label={copy.dataPage.importHistory}>
              <Table>
                <thead>
                  <tr>
                    <Th sticky>Source</Th>
                    <Th>Started</Th>
                    <Th>Status</Th>
                    <Th numeric>Records</Th>
                    <Th>Trigger</Th>
                  </tr>
                </thead>
                <tbody>
                  {importRuns.map((run) => {
                    const source = sources.find((entry) => entry.id === run.dataSourceId);
                    return (
                      <tr key={run.id}>
                        <Td sticky>{source?.name ?? run.dataSourceId}</Td>
                        <Td>{formatUpdatedAt(run.startedAt)}</Td>
                        <Td>
                          <Badge tone={RUN_TONE[run.status]}>{run.status}</Badge>
                        </Td>
                        <Td numeric>{formatNumber(run.recordsImported)}</Td>
                        <Td>{run.triggeredBy}</Td>
                      </tr>
                    );
                  })}
                </tbody>
              </Table>
            </TableWrapper>
          </CardBody>
        </Card>
      </Stack>
    </Container>
  );
}

function SourceCard({ source }: { source: DataSource }) {
  return (
    <Card className="h-full">
      <CardBody>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="text-[0.9375rem] font-semibold tracking-[-0.01em] text-ink">
              {source.name}
            </h3>
            <p className="mt-0.5 text-[0.75rem] text-ink-muted capitalize">
              {source.sourceType.replace("-", " ")}
            </p>
          </div>
          <Badge tone={STATUS_TONE[source.status]}>{source.status}</Badge>
        </div>

        <p className="mt-3 text-[0.8125rem] leading-relaxed text-ink-secondary">
          {source.description}
        </p>

        <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2 border-t border-line pt-3">
          <div>
            <dt className="eyebrow">{copy.dataPage.cadenceLabel}</dt>
            <dd className="mt-0.5 text-[0.8125rem] text-ink capitalize">
              {source.refreshCadence}
            </dd>
          </div>
          <div>
            <dt className="eyebrow">{copy.dataPage.lastImport}</dt>
            <dd className="mt-0.5 text-[0.8125rem] text-ink">
              {formatUpdatedAt(source.lastUpdated)}
            </dd>
          </div>
          <div className="col-span-2">
            <dt className="eyebrow">{copy.dataPage.licenceLabel}</dt>
            <dd className="mt-0.5 text-[0.8125rem] leading-relaxed text-ink-secondary">
              {source.licence ?? "Not applicable — generated locally."}
            </dd>
          </div>
        </dl>

        {source.url.startsWith("http") ? (
          <a
            href={source.url}
            target="_blank"
            rel="noreferrer"
            className="mt-3 inline-flex text-[0.8125rem] font-medium text-accent hover:underline"
          >
            Visit source →
          </a>
        ) : null}
      </CardBody>
    </Card>
  );
}
