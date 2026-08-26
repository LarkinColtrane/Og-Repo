import type { AlertIncident, AlertIncidentStore } from "@/lib/pipeline/alerts";
import type { PipelineSignalCode, SignalSeverity } from "@/lib/pipeline/health";
import type { SqlExecutor } from "./postgres-repository";

/**
 * PostgreSQL-backed alert incidents.
 *
 * The whole reason this class exists is the sequence in
 * `docs/sql/005_alert_incidents.sql`:
 *
 *     fail → alert → restart → incident forgotten → alert again
 *
 * With the in-memory store that happens on every deploy, and on a serverless
 * platform — where each scheduled execution is a fresh process — it happens on
 * *every run*, so the deduplication logic never takes effect at all.
 *
 * The interface is unchanged from `InMemoryAlertIncidentStore`, which is the
 * point: `evaluatePipelineAlerts` decides what to notify and knows nothing about
 * where incidents are kept. Monitoring logic stays independent of both storage
 * and alert providers.
 */
export class PostgresAlertIncidentStore implements AlertIncidentStore {
  readonly name = "PostgreSQL alert_incidents";
  readonly durable = true;

  constructor(private readonly query: SqlExecutor) {}

  async list(): Promise<AlertIncident[]> {
    const rows = await this.query<Record<string, unknown>>(
      `SELECT incident_key, pipeline_id, data_source_id, signal_code, severity,
              opened_at, last_seen_at, last_notified_at, occurrences, last_message
         FROM alert_incidents
        ORDER BY opened_at ASC`,
    );
    return rows.map(toIncident);
  }

  async get(incidentKey: string): Promise<AlertIncident | null> {
    const rows = await this.query<Record<string, unknown>>(
      `SELECT incident_key, pipeline_id, data_source_id, signal_code, severity,
              opened_at, last_seen_at, last_notified_at, occurrences, last_message
         FROM alert_incidents
        WHERE incident_key = $1`,
      [incidentKey],
    );
    return rows[0] ? toIncident(rows[0]) : null;
  }

  /**
   * Insert or update.
   *
   * `opened_at` is deliberately **not** in the `DO UPDATE` list. It is the one
   * field that must survive an escalation — a warning that becomes critical is
   * still the same incident, and overwriting the open time would make every
   * recovery notification report a duration of nearly zero.
   */
  async put(incident: AlertIncident): Promise<void> {
    await this.query(
      `INSERT INTO alert_incidents
         (incident_key, pipeline_id, data_source_id, signal_code, severity,
          opened_at, last_seen_at, last_notified_at, occurrences, last_message)
       VALUES ($1, $2, $3, $4, $5, $6::timestamptz, $7::timestamptz, $8::timestamptz, $9, $10)
       ON CONFLICT (incident_key) DO UPDATE
         SET severity         = EXCLUDED.severity,
             last_seen_at     = EXCLUDED.last_seen_at,
             last_notified_at = EXCLUDED.last_notified_at,
             occurrences      = EXCLUDED.occurrences,
             last_message     = EXCLUDED.last_message,
             updated_at       = now()`,
      [
        incident.incidentKey,
        incident.pipelineId,
        incident.dataSourceId,
        incident.signalCode,
        incident.severity,
        incident.openedAt,
        incident.lastSeenAt,
        incident.lastNotifiedAt,
        incident.occurrences,
        incident.lastMessage,
      ],
    );
  }

  /** Closing an incident removes it. This table holds open state, not history. */
  async delete(incidentKey: string): Promise<void> {
    await this.query(`DELETE FROM alert_incidents WHERE incident_key = $1`, [incidentKey]);
  }
}

/**
 * Map a row to the domain type.
 *
 * `timestamptz` comes back from node-postgres as a JavaScript `Date`. The rest
 * of the alerting code compares ISO strings — `Date.parse(a) - Date.parse(b)` —
 * so converting here keeps the in-memory and PostgreSQL stores behaviourally
 * identical. Leaving `Date` objects in place would make the two implementations
 * disagree about the repeat window in ways no unit test would catch.
 */
function toIncident(row: Record<string, unknown>): AlertIncident {
  return {
    incidentKey: String(row.incident_key),
    pipelineId: String(row.pipeline_id),
    dataSourceId: String(row.data_source_id),
    signalCode: String(row.signal_code) as PipelineSignalCode,
    severity: String(row.severity) as SignalSeverity,
    openedAt: toIso(row.opened_at),
    lastSeenAt: toIso(row.last_seen_at),
    lastNotifiedAt: toIso(row.last_notified_at),
    occurrences: Number(row.occurrences),
    lastMessage: String(row.last_message ?? ""),
  };
}

function toIso(value: unknown): string {
  return value instanceof Date ? value.toISOString() : String(value);
}
