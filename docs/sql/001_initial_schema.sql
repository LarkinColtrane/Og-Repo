-- =============================================================================
-- Montreal Residential Market Intelligence — initial schema
--
-- Apply with:  psql "$DATABASE_URL" -f docs/sql/001_initial_schema.sql
-- On Supabase: paste into the SQL editor, or use the Supabase CLI migrations.
--
-- Design notes worth reading before you change anything:
--
--  * A `period` is a MONTH, stored as a DATE pinned to the first of the month.
--    Postgres has no month type, and a CHECK constraint enforcing day-of-month = 1
--    is more reliable than a convention nobody remembers.
--
--  * Statistics tables are append-only per (neighbourhood, period, breakdown). The
--    natural key is a UNIQUE constraint, which is what makes an import idempotent:
--    re-running the same month UPDATEs rather than duplicating.
--
--  * `data_source_id` is NOT NULL everywhere. A statistic with no traceable
--    source cannot be displayed honestly, so the database refuses to store one.
--
--  * `yoy_change` is stored rather than computed on read. It is expensive to
--    derive in a query across a large table, and storing it lets the import step
--    own the definition — see recalculate_yoy_change() at the bottom.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- Enumerations
--
-- Enums rather than free text: an import writing "Condo" instead of "condo"
-- should fail loudly at the boundary, not create a silent second category that
-- splits every aggregate in half.
-- -----------------------------------------------------------------------------
CREATE TYPE property_type AS ENUM ('condo', 'house', 'plex');

CREATE TYPE bedroom_type AS ENUM ('studio', 'oneBedroom', 'twoBedroom', 'threeBedroom');

CREATE TYPE data_source_type AS ENUM (
  'demo', 'open-data', 'government', 'licensed', 'manual', 'derived'
);

CREATE TYPE data_source_status AS ENUM ('active', 'planned', 'stale', 'error');

CREATE TYPE refresh_cadence AS ENUM (
  'daily', 'monthly', 'quarterly', 'annual', 'irregular'
);

CREATE TYPE import_run_status AS ENUM ('running', 'success', 'failed', 'partial');

CREATE TYPE import_trigger AS ENUM ('schedule', 'manual', 'webhook');

-- -----------------------------------------------------------------------------
-- data_sources — the provenance registry
--
-- Populated before any statistics are imported. Every row in the statistics
-- tables points here, which is what the "Source: CMHC · Updated Oct. 2026" badge
-- in the UI reads from.
-- -----------------------------------------------------------------------------
CREATE TABLE data_sources (
  id               TEXT PRIMARY KEY,
  name             TEXT NOT NULL,
  source_type      data_source_type NOT NULL,
  url              TEXT NOT NULL DEFAULT '',
  description      TEXT NOT NULL DEFAULT '',
  licence          TEXT,
  refresh_cadence  refresh_cadence NOT NULL DEFAULT 'monthly',
  status           data_source_status NOT NULL DEFAULT 'planned',
  last_updated     TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON COLUMN data_sources.last_updated IS
  'Timestamp of the last SUCCESSFUL import. A failed run must not advance this.';

-- -----------------------------------------------------------------------------
-- neighbourhoods — the dimension table
--
-- Adding a neighbourhood is one INSERT here; nothing in the application needs to
-- change. `dwelling_stock` holds approximate unit counts by property type and is
-- used as the weighting when neighbourhood figures are rolled up to a city-wide
-- median or average.
-- -----------------------------------------------------------------------------
CREATE TABLE neighbourhoods (
  id              TEXT PRIMARY KEY,
  name            TEXT NOT NULL,
  slug            TEXT NOT NULL UNIQUE,
  borough         TEXT NOT NULL,
  latitude        NUMERIC(9, 6) NOT NULL,
  longitude       NUMERIC(9, 6) NOT NULL,
  -- Neutral description of location and built form. NOT a market claim: anything
  -- of the form "prices are rising" is computed from the statistics instead.
  profile         TEXT NOT NULL DEFAULT '',
  -- { "condo": 12000, "house": 900, "plex": 14000 }
  dwelling_stock  JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX neighbourhoods_slug_idx ON neighbourhoods (slug);

-- -----------------------------------------------------------------------------
-- neighbourhood_boundaries — GeoJSON outlines
--
-- Separate from `neighbourhoods` because the geometry is large, changes on a
-- different schedule, and most queries never need it. Until this table is
-- populated from the Ville de Montréal open-data boundary set, the market map
-- renders its schematic fallback rather than approximating outlines.
--
-- If PostGIS is available, prefer `geometry(MultiPolygon, 4326)` over JSONB and
-- add a GiST index.
-- -----------------------------------------------------------------------------
CREATE TABLE neighbourhood_boundaries (
  neighbourhood_id TEXT PRIMARY KEY REFERENCES neighbourhoods (id) ON DELETE CASCADE,
  -- A GeoJSON Feature whose geometry is a Polygon or MultiPolygon, WGS 84.
  feature          JSONB NOT NULL,
  data_source_id   TEXT NOT NULL REFERENCES data_sources (id),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- -----------------------------------------------------------------------------
-- sale_market_stats — resale statistics
--
-- One row per neighbourhood × property type × month.
-- -----------------------------------------------------------------------------
CREATE TABLE sale_market_stats (
  id                      BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  neighbourhood_id        TEXT NOT NULL REFERENCES neighbourhoods (id) ON DELETE CASCADE,
  period                  DATE NOT NULL,
  property_type           property_type NOT NULL,

  median_price            NUMERIC(12, 2) NOT NULL CHECK (median_price >= 0),
  average_price_per_sqft  NUMERIC(10, 2) CHECK (average_price_per_sqft >= 0),
  active_listings         INTEGER NOT NULL DEFAULT 0 CHECK (active_listings >= 0),
  new_listings            INTEGER NOT NULL DEFAULT 0 CHECK (new_listings >= 0),
  sales_count             INTEGER NOT NULL DEFAULT 0 CHECK (sales_count >= 0),
  average_days_on_market  INTEGER CHECK (average_days_on_market >= 0),
  -- Sale price as a percentage of asking price. Over 100 = sold above asking.
  listing_to_sale_ratio   NUMERIC(6, 2),
  -- Percentage change in median_price against the same month one year earlier.
  -- NULL when there is no comparison period on record — never zero as a stand-in.
  yoy_change              NUMERIC(6, 2),

  data_source_id          TEXT NOT NULL REFERENCES data_sources (id),
  import_run_id           BIGINT,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- A period is a month: always the first day of it.
  CONSTRAINT sale_period_is_month_start CHECK (date_part('day', period) = 1),
  -- The natural key. This is what makes re-importing a month idempotent.
  CONSTRAINT sale_stats_natural_key UNIQUE (neighbourhood_id, period, property_type)
);

CREATE INDEX sale_stats_period_idx ON sale_market_stats (period DESC);
CREATE INDEX sale_stats_lookup_idx
  ON sale_market_stats (neighbourhood_id, property_type, period DESC);

-- -----------------------------------------------------------------------------
-- rental_market_stats — rental statistics
--
-- One row per neighbourhood × bedroom type × month.
-- -----------------------------------------------------------------------------
CREATE TABLE rental_market_stats (
  id                BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  neighbourhood_id  TEXT NOT NULL REFERENCES neighbourhoods (id) ON DELETE CASCADE,
  period            DATE NOT NULL,
  bedroom_type      bedroom_type NOT NULL,

  average_rent      NUMERIC(10, 2) NOT NULL CHECK (average_rent >= 0),
  median_rent       NUMERIC(10, 2) CHECK (median_rent >= 0),
  -- Percent, not a fraction: 1.8 means 1.8%.
  vacancy_rate      NUMERIC(5, 2) CHECK (vacancy_rate >= 0 AND vacancy_rate <= 100),
  yoy_change        NUMERIC(6, 2),

  data_source_id    TEXT NOT NULL REFERENCES data_sources (id),
  import_run_id     BIGINT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT rental_period_is_month_start CHECK (date_part('day', period) = 1),
  CONSTRAINT rental_stats_natural_key UNIQUE (neighbourhood_id, period, bedroom_type)
);

CREATE INDEX rental_stats_period_idx ON rental_market_stats (period DESC);
CREATE INDEX rental_stats_lookup_idx
  ON rental_market_stats (neighbourhood_id, bedroom_type, period DESC);

-- -----------------------------------------------------------------------------
-- import_runs — the audit trail
--
-- Every automated import opens a row here before touching anything, and closes it
-- on the way out. Without this you cannot answer "when did this number last
-- change, and why", which is the first question asked when a figure looks wrong.
-- -----------------------------------------------------------------------------
CREATE TABLE import_runs (
  id                BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  data_source_id    TEXT NOT NULL REFERENCES data_sources (id),
  started_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at      TIMESTAMPTZ,
  status            import_run_status NOT NULL DEFAULT 'running',
  records_imported  INTEGER NOT NULL DEFAULT 0,
  error_message     TEXT,
  triggered_by      import_trigger NOT NULL DEFAULT 'schedule',
  -- Free-form detail: the URL fetched, the file name, row counts by table.
  metadata          JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX import_runs_source_idx ON import_runs (data_source_id, started_at DESC);

ALTER TABLE sale_market_stats
  ADD CONSTRAINT sale_stats_import_run_fk
  FOREIGN KEY (import_run_id) REFERENCES import_runs (id) ON DELETE SET NULL;

ALTER TABLE rental_market_stats
  ADD CONSTRAINT rental_stats_import_run_fk
  FOREIGN KEY (import_run_id) REFERENCES import_runs (id) ON DELETE SET NULL;

-- -----------------------------------------------------------------------------
-- Year-over-year recalculation
--
-- Run after every import. Comparing each row with the same month one year earlier
-- means a late-arriving backfill automatically fixes the YoY figures that were
-- previously NULL, without any special-casing in the importer.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION recalculate_yoy_change()
RETURNS void
LANGUAGE sql
AS $$
  UPDATE sale_market_stats s
     SET yoy_change = ROUND(
           ((s.median_price - prev.median_price) / NULLIF(prev.median_price, 0)) * 100,
           2
         ),
         updated_at = now()
    FROM sale_market_stats prev
   WHERE prev.neighbourhood_id = s.neighbourhood_id
     AND prev.property_type    = s.property_type
     AND prev.period           = s.period - INTERVAL '1 year'
     AND s.yoy_change IS DISTINCT FROM ROUND(
           ((s.median_price - prev.median_price) / NULLIF(prev.median_price, 0)) * 100,
           2
         );

  UPDATE rental_market_stats r
     SET yoy_change = ROUND(
           ((r.average_rent - prev.average_rent) / NULLIF(prev.average_rent, 0)) * 100,
           2
         ),
         updated_at = now()
    FROM rental_market_stats prev
   WHERE prev.neighbourhood_id = r.neighbourhood_id
     AND prev.bedroom_type     = r.bedroom_type
     AND prev.period           = r.period - INTERVAL '1 year'
     AND r.yoy_change IS DISTINCT FROM ROUND(
           ((r.average_rent - prev.average_rent) / NULLIF(prev.average_rent, 0)) * 100,
           2
         );
$$;

-- -----------------------------------------------------------------------------
-- Convenience view: the latest month of sale statistics per neighbourhood.
-- The dashboard's headline figures come from here.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE VIEW latest_sale_stats AS
SELECT DISTINCT ON (neighbourhood_id, property_type) *
  FROM sale_market_stats
 ORDER BY neighbourhood_id, property_type, period DESC;

CREATE OR REPLACE VIEW latest_rental_stats AS
SELECT DISTINCT ON (neighbourhood_id, bedroom_type) *
  FROM rental_market_stats
 ORDER BY neighbourhood_id, bedroom_type, period DESC;

COMMIT;

-- =============================================================================
-- Row Level Security (Supabase)
--
-- Supabase exposes tables through PostgREST with the anon key, so RLS is not
-- optional there. This platform serves aggregates only, so public read is fine;
-- writes must come from the service role, which imports run as.
-- Uncomment when deploying to Supabase.
-- =============================================================================
-- ALTER TABLE neighbourhoods      ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE sale_market_stats   ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE rental_market_stats ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE data_sources        ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE import_runs         ENABLE ROW LEVEL SECURITY;
--
-- CREATE POLICY public_read ON neighbourhoods      FOR SELECT USING (true);
-- CREATE POLICY public_read ON sale_market_stats   FOR SELECT USING (true);
-- CREATE POLICY public_read ON rental_market_stats FOR SELECT USING (true);
-- CREATE POLICY public_read ON data_sources        FOR SELECT USING (true);
-- -- import_runs stays private: it is operational detail, not public data.
