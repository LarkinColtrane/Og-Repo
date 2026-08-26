import type { Metadata } from "next";
import type { DataSource, ImportRunStatus } from "@/types";
import {
  getBenchmarkRepository,
  getCivicRepository,
  getImportRunStore,
  getMortgageRateRepository,
  getRepository,
} from "@/lib/data";
import { runPipelineMonitor } from "@/lib/pipeline/monitor";
import { copy } from "@/lib/i18n";
import { formatUpdatedAt } from "@/lib/periods";
import { formatNumber } from "@/lib/calculations/format";
import { Container, PageHeader, Section, Stack } from "@/components/ui/section";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Table, TableWrapper, Td, Th } from "@/components/ui/data-table";
import { DemoDataNotice } from "@/components/data/source-badge";
import { PipelineStatusPanel } from "@/components/data/pipeline-status";

export const metadata: Metadata = {
  title: copy.dataPage.title,
  description: copy.dataPage.subtitle,
};

/**
 * Rendered per request, never at build time.
 *
 * An operations dashboard baked into a static build would report the health of
 * a pipeline as it stood the day the site was compiled — which is worse than no
 * dashboard, because it looks current.
 */
export const dynamic = "force-dynamic";

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
  const benchmarks = getBenchmarkRepository();
  const rates = getMortgageRateRepository();
  const civic = getCivicRepository();
  const runStore = getImportRunStore();

  const [sources, demoRuns, monitor, realRuns] = await Promise.all([
    repository.listDataSources(),
    repository.listImportRuns(),
    // `notify: false` — this is a dashboard read, not a monitoring execution.
    // Rendering a page must never send an alert, or every refresh would page
    // somebody.
    runPipelineMonitor({ notify: false }),
    runStore.listRuns(undefined, 25),
  ]);

  const connected = sources.filter((source) => source.status !== "planned");
  const planned = sources.filter((source) => source.status === "planned");

  /**
   * Per-dataset quality.
   *
   * Four repositories, four independent flags. This table is the visible form
   * of the rule in `types/api.ts`: one live dataset must never make the others
   * look verified, so each is reported on its own row rather than collapsed
   * into a single site-wide claim.
   */
  const datasets = [
    { label: "Market statistics (prices, rents)", quality: repository.dataQuality, store: repository.name },
    { label: "Mortgage rates", quality: rates.dataQuality, store: rates.name },
    { label: "Market benchmarks (bond yields)", quality: benchmarks.dataQuality, store: benchmarks.name },
    { label: "Civic data (construction permits)", quality: civic.dataQuality, store: civic.name },
  ];

  // Runs the pipeline actually recorded in this process, kept apart from the
  // generator's sample rows. Merging them would let a fabricated success sit in
  // the same table as a real failure with nothing to tell them apart.
  const importRuns = realRuns.length > 0 ? realRuns : demoRuns;
  const runsAreReal = realRuns.length > 0;

  return (
    <Container className="py-10 sm:py-12">
      <Stack className="animate-rise">
        <PageHeader
          title={copy.dataPage.title}
          description={copy.dataPage.subtitle}
          meta={<Badge tone="neutral">Backing store: {repository.name}</Badge>}
        />

        <DemoDataNotice />

        <PipelineStatusPanel
          reports={monitor.reports}
          overall={monitor.overall}
          storeNames={[
            { label: "Market statistics", name: repository.name },
            { label: "Mortgage rates", name: rates.name },
            { label: "Market benchmarks", name: benchmarks.name },
            { label: "Civic data", name: civic.name },
            { label: "Import audit trail", name: runStore.name },
            { label: "Alert incidents", name: monitor.alerting.incidentStore },
          ]}
        />

        <Card>
          <CardHeader
            title="Data quality by dataset"
            description="Each dataset has its own backing store and becomes live on its own day. A single connected source never relabels the rest — which is why this is a table and not one badge."
          />
          <CardBody>
            <TableWrapper label="Data quality by dataset">
              <Table>
                <thead>
                  <tr>
                    <Th sticky>Dataset</Th>
                    <Th>Quality</Th>
                    <Th>Backing store</Th>
                  </tr>
                </thead>
                <tbody>
                  {datasets.map((dataset) => (
                    <tr key={dataset.label}>
                      <Td sticky>{dataset.label}</Td>
                      <Td>
                        <Badge tone={dataset.quality === "live" ? "good" : "warning"}>
                          {dataset.quality === "live" ? "Live" : "Demo"}
                        </Badge>
                      </Td>
                      <Td>{dataset.store}</Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </TableWrapper>
          </CardBody>
        </Card>

        <Section title={copy.dataPage.connected}>
          <div className="grid grid-cols-1 gap-3 sm:gap-4 lg:grid-cols-2">
            {connected.map((source) => (
              <SourceCard key={source.id} source={source} />
            ))}
          </div>
        </Section>

        <Section
          title={copy.dataPage.planned}
          description="Identified integrations that are NOT importing. Some have a complete pipeline written and tested — the Ville de Montréal permits connector does — and are still listed here, because a pipeline that has never run against its publisher is not a connection. None of these contributes a single number to this site."
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
            description={
              runsAreReal
                ? "Every import writes a row here, success or failure. These are real runs recorded by the pipeline in this process — the in-memory audit trail does not survive a restart, which is stated rather than hidden."
                : "Every import writes a row here — the audit trail an automated pipeline needs. No real import has run in this process yet, so these are sample rows from the demo generator."
            }
            actions={
              <Badge tone={runsAreReal ? "good" : "neutral"}>
                {runsAreReal ? "Recorded runs" : "Sample rows"}
              </Badge>
            }
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
