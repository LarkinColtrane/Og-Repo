import type { PipelineHealthReport, PipelineState } from "@/lib/pipeline/health";
import { PIPELINE_STATE_RANK } from "@/lib/pipeline/health";
import { formatUpdatedAt } from "@/lib/periods";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";

/**
 * Pipeline health, rendered.
 *
 * This component contains **no rule about what healthy means**. It receives
 * `PipelineHealthReport` objects that `lib/pipeline/health.ts` produced and
 * renders them. That separation is the reason the health engine is a pure
 * function outside React: the same reports drive this page, the alerting job
 * and the diagnostics endpoint, so a green card here and a firing alert cannot
 * disagree — they are reading the same object.
 *
 * The states map to tone rather than being coloured ad hoc, and `demo` is
 * deliberately **not** green. A generated dataset is not a working pipeline,
 * and showing it in the same colour as one would undo the point of the page.
 */

const STATE_TONE: Record<PipelineState, BadgeTone> = {
  healthy: "good",
  degraded: "warning",
  failing: "critical",
  stale: "warning",
  // Neutral, not green: nothing is wrong, but nothing is connected either.
  demo: "neutral",
  unavailable: "neutral",
};

const STATE_LABEL: Record<PipelineState, string> = {
  healthy: "Healthy",
  degraded: "Degraded",
  failing: "Failing",
  stale: "Stale",
  demo: "Demo data",
  unavailable: "Not connected",
};

export function PipelineStatusPanel({
  reports,
  overall,
  storeNames,
}: {
  reports: PipelineHealthReport[];
  overall: PipelineState;
  /** What is actually backing each store right now. */
  storeNames: Array<{ label: string; name: string }>;
}) {
  // Worst first, so a problem is never below the fold.
  const ordered = [...reports].sort(
    (a, b) => PIPELINE_STATE_RANK[a.state] - PIPELINE_STATE_RANK[b.state],
  );

  return (
    <Card>
      <CardHeader
        title="Pipeline status"
        description="Live health of every ingestion pipeline in this deployment, assessed on page load. Two separate questions: is the data current, and is anything still trying to import it?"
        actions={<Badge tone={STATE_TONE[overall]}>{STATE_LABEL[overall]}</Badge>}
      />
      <CardBody>
        <ul className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          {ordered.map((report) => (
            <li
              key={report.pipelineId}
              className="rounded-md border border-line bg-surface-inset p-3.5"
            >
              <div className="flex items-start justify-between gap-3">
                <h3 className="min-w-0 text-[0.875rem] font-semibold tracking-[-0.01em] text-ink">
                  {report.label}
                </h3>
                <Badge tone={STATE_TONE[report.state]}>{STATE_LABEL[report.state]}</Badge>
              </div>

              <p className="mt-2 text-[0.8125rem] leading-relaxed text-ink-secondary">
                {report.headline}
              </p>

              {/* Every signal, not just the one that decided the state. A
                  pipeline that is `failing` may also be `stale`, and hiding the
                  second means fixing the first and being surprised. */}
              {report.signals.length > 0 ? (
                <ul className="mt-2.5 space-y-1.5">
                  {report.signals.map((signal) => (
                    <li
                      key={signal.code}
                      className="flex gap-2 text-[0.75rem] leading-relaxed text-ink-muted"
                    >
                      <span
                        aria-hidden="true"
                        className={`mt-1.5 inline-block h-1.5 w-1.5 shrink-0 rounded-full ${
                          signal.severity === "critical"
                            ? "bg-critical"
                            : signal.severity === "warning"
                              ? "bg-warning"
                              : "bg-ink-muted"
                        }`}
                      />
                      <span>{signal.message}</span>
                    </li>
                  ))}
                </ul>
              ) : null}

              <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 border-t border-line pt-2.5">
                <div>
                  <dt className="eyebrow">Newest data</dt>
                  <dd className="mt-0.5 text-[0.8125rem] text-ink tabular">
                    {report.latestObservationDate ?? "—"}
                  </dd>
                </div>
                <div>
                  <dt className="eyebrow">Last success</dt>
                  <dd className="mt-0.5 text-[0.8125rem] text-ink">
                    {report.lastSuccessAt ? formatUpdatedAt(report.lastSuccessAt) : "Never"}
                  </dd>
                </div>
                <div>
                  <dt className="eyebrow">Import runs</dt>
                  <dd className="mt-0.5 text-[0.8125rem] text-ink tabular">
                    {report.totalRuns}
                  </dd>
                </div>
                <div>
                  <dt className="eyebrow">Consecutive failures</dt>
                  <dd className="mt-0.5 text-[0.8125rem] text-ink tabular">
                    {report.consecutiveFailures}
                  </dd>
                </div>
              </dl>
            </li>
          ))}
        </ul>

        <dl className="mt-4 grid grid-cols-1 gap-x-6 gap-y-2 border-t border-line pt-3 sm:grid-cols-2">
          {storeNames.map((store) => (
            <div key={store.label} className="flex flex-wrap items-baseline gap-x-2">
              <dt className="eyebrow">{store.label}</dt>
              <dd className="text-[0.75rem] text-ink-secondary">{store.name}</dd>
            </div>
          ))}
        </dl>
      </CardBody>
    </Card>
  );
}
