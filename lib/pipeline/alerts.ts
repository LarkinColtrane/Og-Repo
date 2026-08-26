import type {
  PipelineHealthReport,
  PipelineSignal,
  PipelineSignalCode,
  PipelineState,
  SignalSeverity,
} from "./health";

/**
 * Turning health into notifications.
 *
 * ## The problem this solves
 *
 * A monitor that alerts on every observation of a problem is a monitor nobody
 * reads. A pipeline scheduled every fifteen minutes that has been broken since
 * Friday would send 288 identical messages over a weekend, and the 289th — the
 * one about a *different* pipeline — would arrive in a channel everyone had
 * already muted.
 *
 * So alerting is stateful. An **incident** is opened the first time a problem is
 * seen and stays open while it persists; the notification goes out when the
 * incident opens, and then at most once per `repeatAfterSeconds` while it stays
 * open. When the problem stops being reported, the incident closes and a
 * **recovery** notification goes out — because "it is fixed" is exactly as
 * operationally useful as "it is broken", and a channel that only ever carries
 * bad news teaches people that silence means nothing rather than that silence
 * means healthy.
 *
 * ## What is an incident, exactly
 *
 * `pipelineId` + signal code. Two different problems on one pipeline are two
 * incidents, so a stale-data alert is not suppressed by an unrelated
 * validation-rejection alert that happened to fire first. The same problem
 * recurring on one pipeline is one incident however many runs observe it. And
 * `pipelineId` rather than `dataSourceId` because one source can feed several
 * series, which fail independently.
 *
 * ## What does not alert
 *
 * `info` signals. `demo-fallback` is the only one today, and paging somebody
 * because a demo build is serving demo data is how alert fatigue starts.
 */

export type AlertKind =
  /** First observation of a new problem. */
  | "raised"
  /** The problem is still open and the repeat interval has elapsed. */
  | "reminder"
  /** The problem is no longer reported. */
  | "recovered";

export interface PipelineAlert {
  /** Stable across the life of one incident: `<pipelineId>:<signalCode>`. */
  incidentKey: string;
  kind: AlertKind;
  pipelineId: string;
  dataSourceId: string;
  /** Human label of the source, for a subject line. */
  label: string;
  signalCode: PipelineSignalCode;
  severity: SignalSeverity;
  /** Pipeline state at the moment the alert was produced. */
  state: PipelineState;
  title: string;
  message: string;
  /** When the underlying problem was first observed. */
  openedAt: string;
  /** When this alert was produced. */
  raisedAt: string;
  /** How many evaluations have observed this incident, including this one. */
  occurrences: number;
  detail: Record<string, unknown>;
}

/** One open problem, as remembered between evaluations. */
export interface AlertIncident {
  incidentKey: string;
  pipelineId: string;
  dataSourceId: string;
  signalCode: PipelineSignalCode;
  severity: SignalSeverity;
  openedAt: string;
  lastSeenAt: string;
  /** When a notification was last actually sent for this incident. */
  lastNotifiedAt: string;
  occurrences: number;
  lastMessage: string;
}

/**
 * Where open incidents are remembered.
 *
 * An interface, not a class, for the same reason the repositories are: today it
 * is a process-local map, and on a serverless platform where each invocation is
 * a fresh process it will need to be a table. Swapping it is then one factory,
 * and the deduplication rule above does not change.
 *
 * ⚠️ With the in-memory implementation, a scheduler running in a fresh process
 * every time will treat every evaluation as a new incident and re-notify. That
 * limitation is reported in the monitor's response rather than left to be
 * discovered from a noisy channel — see `lib/pipeline/monitor.ts`.
 */
export interface AlertIncidentStore {
  readonly name: string;
  /** True when incidents survive between scheduler invocations. */
  readonly durable: boolean;
  list(): Promise<AlertIncident[]>;
  get(incidentKey: string): Promise<AlertIncident | null>;
  put(incident: AlertIncident): Promise<void>;
  delete(incidentKey: string): Promise<void>;
}

export class InMemoryAlertIncidentStore implements AlertIncidentStore {
  readonly name = "In-memory (incidents reset when the process restarts)";
  readonly durable = false;

  private incidents = new Map<string, AlertIncident>();

  async list(): Promise<AlertIncident[]> {
    return [...this.incidents.values()];
  }

  async get(incidentKey: string): Promise<AlertIncident | null> {
    return this.incidents.get(incidentKey) ?? null;
  }

  async put(incident: AlertIncident): Promise<void> {
    this.incidents.set(incident.incidentKey, incident);
  }

  async delete(incidentKey: string): Promise<void> {
    this.incidents.delete(incidentKey);
  }
}

/** Six hours: often enough that an outage is not forgotten, rare enough to read. */
export const DEFAULT_REPEAT_AFTER_SECONDS = 6 * 60 * 60;

export function repeatAfterSecondsFromEnv(
  value: string | undefined = process.env.PIPELINE_ALERT_REPEAT_SECONDS,
): number {
  if (!value) return DEFAULT_REPEAT_AFTER_SECONDS;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return DEFAULT_REPEAT_AFTER_SECONDS;
  return Math.floor(parsed);
}

export interface EvaluateAlertsOptions {
  store: AlertIncidentStore;
  now?: () => Date;
  repeatAfterSeconds?: number;
}

export interface AlertEvaluation {
  /** Alerts to deliver. */
  alerts: PipelineAlert[];
  /** Incidents observed again but not re-notified, and why. */
  suppressed: Array<{ incidentKey: string; reason: string; nextEligibleAt: string }>;
  /** Every incident still open after this evaluation. */
  open: AlertIncident[];
}

function incidentKey(pipelineId: string, code: PipelineSignalCode): string {
  return `${pipelineId}:${code}`;
}

function alertable(signal: PipelineSignal): boolean {
  // `info` is descriptive, not actionable. Nothing to wake anyone for.
  return signal.severity === "warning" || signal.severity === "critical";
}

/**
 * Compare the current health of a set of pipelines against the open incidents,
 * and decide what to notify.
 *
 * **Only pipelines present in `reports` are considered.** Evaluating one
 * pipeline must not close another's incident just because this run did not look
 * at it — that would send a recovery notification for a problem still happening.
 */
export async function evaluatePipelineAlerts(
  reports: PipelineHealthReport[],
  options: EvaluateAlertsOptions,
): Promise<AlertEvaluation> {
  const now = options.now ?? (() => new Date());
  const repeatAfterSeconds = options.repeatAfterSeconds ?? repeatAfterSecondsFromEnv();
  const { store } = options;

  const timestamp = now().toISOString();
  const alerts: PipelineAlert[] = [];
  const suppressed: AlertEvaluation["suppressed"] = [];

  const assessed = new Set(reports.map((report) => report.pipelineId));
  const seenKeys = new Set<string>();

  for (const report of reports) {
    for (const signal of report.signals) {
      if (!alertable(signal)) continue;

      const key = incidentKey(report.pipelineId, signal.code);
      seenKeys.add(key);

      const existing = await store.get(key);

      if (!existing) {
        const incident: AlertIncident = {
          incidentKey: key,
          pipelineId: report.pipelineId,
          dataSourceId: report.dataSourceId,
          signalCode: signal.code,
          severity: signal.severity,
          openedAt: timestamp,
          lastSeenAt: timestamp,
          lastNotifiedAt: timestamp,
          occurrences: 1,
          lastMessage: signal.message,
        };
        await store.put(incident);
        alerts.push(buildAlert("raised", report, signal, incident, timestamp));
        continue;
      }

      const occurrences = existing.occurrences + 1;
      const elapsedSeconds =
        (Date.parse(timestamp) - Date.parse(existing.lastNotifiedAt)) / 1000;
      const dueForReminder = elapsedSeconds >= repeatAfterSeconds;
      // A problem that gets worse re-notifies immediately: being told at 09:00
      // that rows were being rejected should not suppress the 09:15 message
      // saying the pipeline has now stopped entirely.
      const escalated = existing.severity !== "critical" && signal.severity === "critical";

      const incident: AlertIncident = {
        ...existing,
        severity: signal.severity,
        lastSeenAt: timestamp,
        lastNotifiedAt: dueForReminder || escalated ? timestamp : existing.lastNotifiedAt,
        occurrences,
        lastMessage: signal.message,
      };
      await store.put(incident);

      if (dueForReminder || escalated) {
        alerts.push(
          buildAlert(escalated ? "raised" : "reminder", report, signal, incident, timestamp),
        );
      } else {
        const nextEligibleAt = new Date(
          Date.parse(existing.lastNotifiedAt) + repeatAfterSeconds * 1000,
        ).toISOString();
        suppressed.push({
          incidentKey: key,
          reason: `Already notified at ${existing.lastNotifiedAt}; this incident re-notifies at most every ${repeatAfterSeconds}s.`,
          nextEligibleAt,
        });
      }
    }
  }

  // ── Recoveries ───────────────────────────────────────────────────────────
  for (const incident of await store.list()) {
    if (!assessed.has(incident.pipelineId)) continue;
    if (seenKeys.has(incident.incidentKey)) continue;

    const report = reports.find((entry) => entry.pipelineId === incident.pipelineId);
    await store.delete(incident.incidentKey);
    alerts.push({
      incidentKey: incident.incidentKey,
      kind: "recovered",
      pipelineId: incident.pipelineId,
      dataSourceId: incident.dataSourceId,
      label: report?.label ?? incident.pipelineId,
      signalCode: incident.signalCode,
      severity: "info",
      state: report?.state ?? "healthy",
      title: `Recovered: ${report?.label ?? incident.pipelineId} — ${describeSignalCode(incident.signalCode)}`,
      message: `This condition is no longer reported. It was first seen at ${incident.openedAt} and observed ${incident.occurrences} time(s). Previous message: ${incident.lastMessage}`,
      openedAt: incident.openedAt,
      raisedAt: timestamp,
      occurrences: incident.occurrences,
      detail: {
        resolvedAfterSeconds: Math.round(
          (Date.parse(timestamp) - Date.parse(incident.openedAt)) / 1000,
        ),
        currentState: report?.state ?? null,
      },
    });
  }

  return { alerts, suppressed, open: await store.list() };
}

function buildAlert(
  kind: Exclude<AlertKind, "recovered">,
  report: PipelineHealthReport,
  signal: PipelineSignal,
  incident: AlertIncident,
  timestamp: string,
): PipelineAlert {
  const prefix = signal.severity === "critical" ? "Pipeline failing" : "Pipeline warning";
  return {
    incidentKey: incident.incidentKey,
    kind,
    pipelineId: report.pipelineId,
    dataSourceId: report.dataSourceId,
    label: report.label,
    signalCode: signal.code,
    severity: signal.severity,
    state: report.state,
    title: `${prefix}: ${report.label} — ${describeSignalCode(signal.code)}`,
    message: signal.message,
    openedAt: incident.openedAt,
    raisedAt: timestamp,
    occurrences: incident.occurrences,
    detail: {
      ...(signal.detail ?? {}),
      state: report.state,
      freshness: report.freshness,
      consecutiveFailures: report.consecutiveFailures,
      lastSuccessAt: report.lastSuccessAt,
      latestObservationDate: report.latestObservationDate,
    },
  };
}

/** Short human name for a signal code, used in alert subject lines. */
export function describeSignalCode(code: PipelineSignalCode): string {
  const names: Record<PipelineSignalCode, string> = {
    "consecutive-failures": "import failures",
    "stale-data": "stale data",
    "validation-rejections": "rows failing validation",
    "unit-anomaly": "a suspected upstream unit change",
    "persistence-failure": "a write failure",
    "empty-range": "an empty response",
    "never-imported": "no data imported yet",
    "demo-fallback": "demo data",
  };
  return names[code];
}
