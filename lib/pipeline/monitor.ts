import type { BenchmarkSeriesCode } from "@/types/benchmark";
import {
  BENCHMARK_SERIES,
  SCHEDULED_BENCHMARK_SERIES,
} from "@/lib/pipeline/connectors/bank-of-canada/series";
import { getBenchmarkSnapshot } from "@/lib/data/benchmark-service";
import {
  getAlertIncidentStore,
  getBenchmarkRepository,
  getImportRunStore,
} from "@/lib/data";
import type { ImportRun } from "@/types";
import {
  assessPipelineHealth,
  overallPipelineState,
  toRunSummary,
  type PipelineHealthReport,
  type PipelineState,
} from "./health";
import {
  evaluatePipelineAlerts,
  repeatAfterSecondsFromEnv,
  type AlertIncident,
  type AlertIncidentStore,
  type PipelineAlert,
} from "./alerts";
import {
  dispatchAlerts,
  getAlertProviders,
  type AlertDelivery,
  type AlertProvider,
} from "./alert-providers";

/**
 * The monitoring orchestrator: read state → assess → alert → deliver.
 *
 * This is the one place that knows all four pieces exist. The health engine does
 * not know about alerts, the alert evaluator does not know about transports, and
 * none of them know about the benchmark repository. Assembling them here means a
 * second pipeline (Stage B's Montreal data) plugs in by adding a collector
 * function, with nothing else to change.
 *
 * Called from the scheduler endpoint after each ingest, and from the operations
 * dashboard in read-only mode — see `notify: false`.
 */

export interface PipelineMonitorOptions {
  /** Which benchmark series to assess. Defaults to the scheduled ones. */
  seriesCodes?: readonly BenchmarkSeriesCode[];
  /** When false, health is assessed and nothing is sent. For dashboards. */
  notify?: boolean;
  now?: () => Date;
  incidentStore?: AlertIncidentStore;
  providers?: AlertProvider[];
  repeatAfterSeconds?: number;
}

export interface PipelineMonitorResult {
  overall: PipelineState;
  reports: PipelineHealthReport[];
  alerts: PipelineAlert[];
  suppressed: Array<{ incidentKey: string; reason: string; nextEligibleAt: string }>;
  openIncidents: AlertIncident[];
  deliveries: AlertDelivery[];
  /** How alerting is configured, so a misconfiguration is visible. */
  alerting: {
    notified: boolean;
    providers: string[];
    repeatAfterSeconds: number;
    incidentStore: string;
    /**
     * Present when incidents do not survive between invocations. On a platform
     * that runs each scheduled execution in a fresh process, deduplication
     * cannot work and every evaluation re-notifies. Saying so here is the
     * difference between a known limitation and a mystery.
     */
    deduplicationWarning: string | null;
  };
}

/**
 * Assess every scheduled benchmark series.
 *
 * Freshness comes from the benchmark snapshot; run outcomes come from the import
 * store. Both are needed: see the note in `health.ts` about the two independent
 * failure modes.
 */
export async function collectBenchmarkHealth(
  seriesCodes: readonly BenchmarkSeriesCode[] = SCHEDULED_BENCHMARK_SERIES,
  options: { now?: () => Date } = {},
): Promise<PipelineHealthReport[]> {
  const repository = getBenchmarkRepository();
  const importRuns = getImportRunStore();

  return Promise.all(
    seriesCodes.map(async (code) => {
      const series = BENCHMARK_SERIES[code];
      const snapshot = await getBenchmarkSnapshot(code);
      const importHealth = await importRuns.getHealth(series.sourceId);
      const runs = await importRuns.listRuns(series.sourceId, 5);

      return assessPipelineHealth(
        {
          pipelineId: `${series.sourceId}:${code}`,
          dataSourceId: series.sourceId,
          label: series.shortLabel,
          dataQuality: repository.dataQuality,
          freshness: snapshot.freshness,
          businessDayLag: snapshot.businessDayLag,
          maxBusinessDayLag: series.maxBusinessDayLag,
          latestObservationDate: snapshot.latest?.observationDate ?? null,
          importHealth,
          lastRun: toRunSummary(mostRecentCompleted(runs)),
        },
        options,
      );
    }),
  );
}

/** The newest run that actually finished — a `running` row says nothing yet. */
function mostRecentCompleted(
  runs: ImportRun[],
): (ImportRun & { errorKind?: string | null; recordsRejected?: number }) | undefined {
  return runs.find((run) => run.status !== "running");
}

export async function runPipelineMonitor(
  options: PipelineMonitorOptions = {},
): Promise<PipelineMonitorResult> {
  const notify = options.notify ?? true;
  const incidentStore = options.incidentStore ?? getAlertIncidentStore();
  const providers = options.providers ?? getAlertProviders();
  const repeatAfterSeconds = options.repeatAfterSeconds ?? repeatAfterSecondsFromEnv();

  const reports = await collectBenchmarkHealth(options.seriesCodes, { now: options.now });

  if (!notify) {
    return {
      overall: overallPipelineState(reports),
      reports,
      alerts: [],
      suppressed: [],
      openIncidents: await incidentStore.list(),
      deliveries: [],
      alerting: {
        notified: false,
        providers: providers.map((provider) => provider.name),
        repeatAfterSeconds,
        incidentStore: incidentStore.name,
        deduplicationWarning: deduplicationWarning(incidentStore),
      },
    };
  }

  const evaluation = await evaluatePipelineAlerts(reports, {
    store: incidentStore,
    now: options.now,
    repeatAfterSeconds,
  });

  // Delivery failures are collected, never thrown: a monitoring outage must not
  // become a data outage by failing the run that reported it.
  const deliveries = await dispatchAlerts(evaluation.alerts, providers);

  return {
    overall: overallPipelineState(reports),
    reports,
    alerts: evaluation.alerts,
    suppressed: evaluation.suppressed,
    openIncidents: evaluation.open,
    deliveries,
    alerting: {
      notified: true,
      providers: providers.map((provider) => provider.name),
      repeatAfterSeconds,
      incidentStore: incidentStore.name,
      deduplicationWarning: deduplicationWarning(incidentStore),
    },
  };
}

function deduplicationWarning(store: AlertIncidentStore): string | null {
  return store.durable
    ? null
    : "Open incidents are held in process memory. On a host that runs each scheduled execution in a fresh process, every evaluation will look like a new incident and re-notify. Back this with a database before relying on deduplication.";
}
