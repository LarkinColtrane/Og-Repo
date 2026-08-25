import type { Metadata } from "next";
import { copy } from "@/lib/i18n";
import { Container, PageHeader, Stack } from "@/components/ui/section";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";

export const metadata: Metadata = {
  title: copy.analyzer.title,
  description: copy.analyzer.subtitle,
};

/**
 * The property analyzer, deliberately not implemented.
 *
 * Everything else on this platform runs on synthetic data that is labelled as
 * such. A property valuation is different in kind: an address-level number reads
 * as a fact about *that building*, and no disclaimer undoes that. So the form is
 * inert, and the page instead documents exactly which data source each future
 * output depends on — which is the useful thing to know while it is being built.
 */
export default function PropertyAnalyzerPage() {
  const planned = [
    {
      label: copy.analyzer.planned.assessment,
      source: copy.analyzer.planned.assessmentSource,
    },
    {
      label: copy.analyzer.planned.marketValue,
      source: copy.analyzer.planned.marketValueSource,
    },
    { label: copy.analyzer.planned.rent, source: copy.analyzer.planned.rentSource },
    { label: copy.analyzer.planned.yield, source: copy.analyzer.planned.yieldSource },
    {
      label: copy.analyzer.planned.appreciation,
      source: copy.analyzer.planned.appreciationSource,
    },
    {
      label: copy.analyzer.planned.comparables,
      source: copy.analyzer.planned.comparablesSource,
    },
    { label: copy.analyzer.planned.score, source: copy.analyzer.planned.scoreSource },
  ];

  return (
    <Container className="py-10 sm:py-12">
      <Stack className="animate-rise">
        <PageHeader
          title={copy.analyzer.title}
          description={copy.analyzer.subtitle}
          meta={<Badge tone="accent">{copy.analyzer.badge}</Badge>}
        />

        <Card>
          <CardBody>
            <div className="mx-auto max-w-2xl py-6 text-center">
              <label
                htmlFor="analyzer-address"
                className="eyebrow block text-center"
              >
                Property address
              </label>
              <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                <input
                  id="analyzer-address"
                  type="text"
                  disabled
                  placeholder={copy.analyzer.inputPlaceholder}
                  aria-describedby="analyzer-note"
                  className="h-11 flex-1 cursor-not-allowed rounded-md border border-line bg-surface-inset px-3.5 text-[0.9375rem] text-ink-muted"
                />
                <span className="inline-flex h-11 cursor-not-allowed items-center justify-center rounded-md border border-line bg-surface-inset px-5 text-[0.875rem] font-medium text-ink-muted">
                  {copy.analyzer.badge}
                </span>
              </div>
              <p
                id="analyzer-note"
                className="mt-4 text-left text-[0.8125rem] leading-relaxed text-ink-secondary"
              >
                {copy.analyzer.disabledNote}
              </p>
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title={copy.analyzer.plannedTitle}
            description="Each output below is blocked on a specific data source. None of them can be approximated from what this platform holds today."
          />
          <CardBody>
            <ul className="divide-y divide-line">
              {planned.map((entry) => (
                <li
                  key={entry.label}
                  className="flex flex-col gap-1 py-3 sm:flex-row sm:items-baseline sm:justify-between sm:gap-6"
                >
                  <span className="text-[0.875rem] font-medium text-ink">
                    {entry.label}
                  </span>
                  <span className="text-[0.75rem] text-ink-muted sm:text-right">
                    Requires: {entry.source}
                  </span>
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="How this would be built" />
          <CardBody>
            <ol className="space-y-3 text-[0.875rem] leading-relaxed text-ink-secondary">
              <li>
                <span className="font-medium text-ink">1. Geocode the address.</span>{" "}
                Resolve it to a lot number and a neighbourhood, so it can be joined to
                the statistics this platform already holds.
              </li>
              <li>
                <span className="font-medium text-ink">
                  2. Look up the assessment.
                </span>{" "}
                The Ville de Montréal assessment roll is public. This is the one
                figure that is a matter of record rather than an estimate.
              </li>
              <li>
                <span className="font-medium text-ink">3. Find comparables.</span>{" "}
                Recent sales of similar properties nearby, from a licensed feed. This
                is the step that requires a commercial agreement.
              </li>
              <li>
                <span className="font-medium text-ink">
                  4. Estimate value and rent, with an interval.
                </span>{" "}
                A point estimate with no confidence interval overstates what
                comparables can tell you. Whatever ships here should show its
                uncertainty.
              </li>
              <li>
                <span className="font-medium text-ink">
                  5. Publish the weighting.
                </span>{" "}
                An investment score is only meaningful if the reader can see what it
                weighs — the same rule the market-condition classification already
                follows.
              </li>
            </ol>
            <p className="mt-5 border-t border-line pt-4 text-[0.75rem] leading-relaxed text-ink-muted">
              The data layer is already shaped for this. A new repository method
              (<code className="text-ink-secondary">getPropertyAnalysis(address)</code>)
              on the <code className="text-ink-secondary">MarketDataRepository</code>{" "}
              interface and a route at{" "}
              <code className="text-ink-secondary">/api/property/[address]</code> is
              the whole surface — see docs/DATA_PIPELINE.md.
            </p>
          </CardBody>
        </Card>
      </Stack>
    </Container>
  );
}
