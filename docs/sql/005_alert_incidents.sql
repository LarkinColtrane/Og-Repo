-- =============================================================================
-- Montreal Residential Market Intelligence — durable alert incidents
--
-- Apply after 001–004:
--   psql "$DATABASE_URL" -f docs/sql/005_alert_incidents.sql
--
-- Makes monitoring state survive a restart.
--
-- The failure this prevents:
--
--     Pipeline fails  →  alert sent  →  server restarts
--                     →  incident forgotten  →  same alert sent again
--
-- On a serverless platform every scheduled execution is a fresh process, so
-- in-memory incidents mean the deduplication logic never once takes effect and
-- a broken pipeline re-alerts on every single run. That is how an alert channel
-- becomes something people mute.
--
-- Design notes:
--
--  * NON-DESTRUCTIVE. Creates one table and nothing else. Applying it to a
--    database holding real data cannot lose a row.
--
--  * The primary key is `incident_key`, which the application composes as
--    `<pipelineId>:<signalCode>`. One open incident per problem per pipeline —
--    exactly the grain the deduplication rule works at, so "is this incident
--    already open?" is a primary-key lookup rather than a scan.
--
--  * A CLOSED incident is DELETED, not flagged. This table holds *open*
--    incidents; it is monitoring state, not an audit log. The audit log already
--    exists — `import_runs` records every attempt, forever — and keeping closed
--    incidents here too would mean two half-histories instead of one whole one.
--    The alert itself carries `openedAt` and `occurrences`, so a recovery
--    notification can still say how long the incident lasted.
--
--  * `last_notified_at` is separate from `last_seen_at` on purpose. Seen is
--    every evaluation; notified is when a message actually went out. The gap
--    between them IS the deduplication window, and collapsing them into one
--    column would silently make every evaluation re-notify.
-- =============================================================================

BEGIN;

CREATE TABLE alert_incidents (
  -- '<pipelineId>:<signalCode>', e.g.
  -- 'src-boc-valet:5y-canada-bond:consecutive-failures'.
  incident_key      TEXT PRIMARY KEY,

  -- The monitored pipeline. Distinct from data_source_id because one source can
  -- feed several series, and a stalled 5-year import must not be able to close
  -- an open incident on the policy rate.
  pipeline_id       TEXT NOT NULL,

  -- The registered source, for grouping on the operations dashboard.
  data_source_id    TEXT NOT NULL,

  -- Which condition: consecutive-failures, stale-data, validation-rejections,
  -- unit-anomaly, persistence-failure, empty-range, never-imported.
  signal_code       TEXT NOT NULL,

  -- Current severity. Stored rather than derived because an incident that
  -- ESCALATES from warning to critical re-notifies immediately, bypassing the
  -- repeat window — and that decision needs the previous value to compare against.
  severity          TEXT NOT NULL CHECK (severity IN ('info', 'warning', 'critical')),

  -- When the problem was first observed. Survives escalation, so a recovery
  -- notification can report the true duration of the outage.
  opened_at         TIMESTAMPTZ NOT NULL,

  -- Most recent evaluation that observed it.
  last_seen_at      TIMESTAMPTZ NOT NULL,

  -- When a notification last actually went out. The deduplication window is
  -- measured from here.
  last_notified_at  TIMESTAMPTZ NOT NULL,

  -- How many evaluations have observed this incident.
  occurrences       INTEGER NOT NULL DEFAULT 1 CHECK (occurrences >= 1),

  -- The most recent message, so a recovery notice can quote what was wrong.
  last_message      TEXT NOT NULL DEFAULT '',

  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE alert_incidents IS
  'OPEN monitoring incidents. One row per (pipeline, signal) currently firing. '
  'Rows are deleted when the condition clears — this is live state, not history; '
  'import_runs is the durable audit log. Without this table, a restart forgets '
  'every open incident and the same alert is sent again, which on a serverless '
  'platform means every scheduled run re-alerts.';

COMMENT ON COLUMN alert_incidents.last_notified_at IS
  'When a message actually went out, as opposed to last_seen_at (every '
  'evaluation). The gap between them is the deduplication window.';

-- The dashboard lists open incidents by pipeline.
CREATE INDEX alert_incidents_pipeline_idx ON alert_incidents (pipeline_id);

COMMIT;

-- =============================================================================
-- Rolling back
--
--   DROP TABLE alert_incidents;
--
-- Safe: it holds live state, not history. The cost is that every currently open
-- incident re-notifies once after the next evaluation.
-- =============================================================================
