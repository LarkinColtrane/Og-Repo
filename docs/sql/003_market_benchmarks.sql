-- =============================================================================
-- Montreal Residential Market Intelligence — market benchmarks
--
-- Apply after 001 and 002:
--   psql "$DATABASE_URL" -f docs/sql/003_market_benchmarks.sql
--
-- Adds the store for published market benchmarks — the Government of Canada
-- 5-year bond yield first — and extends `import_runs` with the counts the
-- ingest pipeline records.
--
-- Design notes:
--
--  * `market_benchmarks` is a HISTORY, not a current value. The whole point is
--    to be able to answer "what was the 5-year yield on 3 April 2024?", which a
--    single-row-per-series table cannot. One row per observation date, forever.
--
--  * The natural key is (series_code, observation_date). That one constraint is
--    what makes re-running a backfill safe: the same range upserts in place
--    rather than doubling the series.
--
--  * `series_code` is OUR identifier (`5y-canada-bond`), not the publisher's
--    (`BD.CDN.5YR.DQ.YLD`). The upstream code lives in the application's series
--    registry. If the Bank renames a series, one TypeScript entry changes and
--    no data migrates.
--
--  * `observation_date` is a DATE, not a timestamp. An observation labels a
--    business day; giving it a time would invite a timezone to decide which day
--    it belongs to.
--
--  * There is deliberately NO `spread` column. The mortgage spread is a lender
--    rate minus a bond yield — both already stored — and materialising it would
--    create a third value to keep in step with two others. It is derived on read.
-- =============================================================================

BEGIN;

CREATE TYPE benchmark_data_quality AS ENUM ('live', 'demo');

-- -----------------------------------------------------------------------------
-- market_benchmarks — one published observation
-- -----------------------------------------------------------------------------
CREATE TABLE market_benchmarks (
  id                BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,

  -- Our series identifier, e.g. '5y-canada-bond'.
  series_code       TEXT NOT NULL,

  -- The business day the value describes.
  observation_date  DATE NOT NULL,

  -- Percent per annum. 3.21 means 3.21%.
  --
  -- The bounds mirror the application's Zod schema and exist for the same
  -- reason: a feed that switches from percent to fractions sends 0.0321, and a
  -- parse slip sends 321. Neither is caught by the type. The range is wide
  -- enough for every rate Canada has ever published — the early-1980s peak was
  -- above 16% — so it rejects corruption without rejecting history.
  value             NUMERIC(8, 4) NOT NULL CHECK (value > -5 AND value < 30),

  -- Data source id, resolvable in `data_sources`. Live observations carry
  -- 'src-boc-valet'; the generated fallback is never written here.
  source            TEXT NOT NULL REFERENCES data_sources (id),

  -- When this observation was fetched — distinct from when it was published.
  -- Conflating the two loses the ability to ask what we knew and when.
  retrieved_at      TIMESTAMPTZ NOT NULL,

  data_quality      benchmark_data_quality NOT NULL DEFAULT 'live',
  import_run_id     BIGINT REFERENCES import_runs (id) ON DELETE SET NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- The natural key. This is what makes ingestion idempotent.
  CONSTRAINT market_benchmarks_natural_key UNIQUE (series_code, observation_date)
);

-- The shape every read uses: one series, newest first or over a window.
CREATE INDEX market_benchmarks_lookup_idx
  ON market_benchmarks (series_code, observation_date DESC);

COMMENT ON TABLE market_benchmarks IS
  'Published market benchmarks such as Government of Canada bond yields. These are wholesale market rates, NOT consumer mortgage offers — see docs/BANK_OF_CANADA.md.';

COMMENT ON COLUMN market_benchmarks.observation_date IS
  'The business day the value describes. Weekends and Canadian market holidays are absent because nothing is published on them; do not interpolate.';

-- -----------------------------------------------------------------------------
-- import_runs — the counts the ingest pipeline records
--
-- The table already exists from 001. Three columns are added rather than a
-- parallel table being created: an import is an import, and one audit trail
-- serving every pipeline is the point of having one at all.
--
-- `records_imported` from the original schema is the written count and keeps its
-- name; received and rejected are the new dimensions. Their difference is what
-- separates "the feed shrank" from "our validation got stricter".
-- -----------------------------------------------------------------------------
ALTER TABLE import_runs
  ADD COLUMN IF NOT EXISTS records_received INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS records_rejected INTEGER NOT NULL DEFAULT 0,
  -- Coarse failure class — 'network', 'timeout', 'http', 'malformed',
  -- 'validation', 'unit-anomaly', 'persistence'. Grouping alerts by kind is what
  -- separates "the publisher is down" from "the publisher changed their format".
  ADD COLUMN IF NOT EXISTS error_kind TEXT;

COMMENT ON COLUMN import_runs.records_received IS
  'Rows the publisher returned, before validation.';
COMMENT ON COLUMN import_runs.records_rejected IS
  'Rows refused by validation. A run with rejections is partial, never success.';

-- -----------------------------------------------------------------------------
-- Freshness, in SQL
--
-- The application computes freshness in business days (see
-- lib/calculations/benchmark.ts). This view is the cheap version for an operator
-- at a psql prompt: latest observation per series and its calendar-day age.
--
-- Calendar days are wrong for a freshness *rule* — Friday's data would look two
-- days stale every Sunday — which is exactly why the real rule lives in the
-- application where the holiday calendar is. This is a glance, not the rule.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE VIEW latest_market_benchmarks AS
SELECT DISTINCT ON (series_code)
       series_code,
       observation_date,
       value,
       source,
       data_quality,
       retrieved_at,
       (CURRENT_DATE - observation_date) AS calendar_days_old
  FROM market_benchmarks
 ORDER BY series_code, observation_date DESC;

COMMIT;

-- =============================================================================
-- Row Level Security (Supabase). Uncomment when deploying there.
-- =============================================================================
-- ALTER TABLE market_benchmarks ENABLE ROW LEVEL SECURITY;
-- CREATE POLICY public_read ON market_benchmarks FOR SELECT USING (true);
--
-- Writes come from the service role that ingestion runs as. A benchmark anyone
-- can write is a benchmark nobody should trust.
