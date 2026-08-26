-- =============================================================================
-- Montreal Residential Market Intelligence — mortgage rates
--
-- Apply after 001_initial_schema.sql:
--   psql "$DATABASE_URL" -f docs/sql/002_mortgage_rates.sql
--
-- Design notes:
--
--  * `mortgage_rates` is a HISTORY, not a snapshot. A lender re-quotes its
--    five-year fixed every few weeks and the old row stays — that is what lets
--    you answer "what were rates when we ran this analysis?". Reads take the
--    latest row per group with DISTINCT ON; see latest_mortgage_rates below.
--
--  * The natural key includes `effective_date`, so re-importing the same day is
--    idempotent while a new day inserts a new row.
--
--  * `borrower_profile` is a real pricing dimension, not a label. An insured
--    mortgage is cheaper for the lender to hold, so it is normally quoted BELOW
--    the uninsured equivalent. Storing one rate per lender would make every
--    down-payment comparison wrong in the same direction.
--
--  * `data_quality` sits on the row rather than being inferred from the source.
--    A backfill of hand-entered rates and a live feed can coexist in one table,
--    and the UI keeps telling the truth about each.
-- =============================================================================

BEGIN;

CREATE TYPE lender_kind AS ENUM ('bank', 'cooperative');
CREATE TYPE mortgage_product_type AS ENUM ('fixed', 'variable');
CREATE TYPE borrower_profile AS ENUM ('insured', 'uninsured');
CREATE TYPE rate_data_quality AS ENUM ('demo', 'live');

-- -----------------------------------------------------------------------------
-- lenders — the institutions compared
--
-- A dimension table, like `neighbourhoods`. Adding a lender is one INSERT; the
-- comparison, the matrix and the API all pick it up with no code change.
-- -----------------------------------------------------------------------------
CREATE TABLE lenders (
  id             TEXT PRIMARY KEY,
  name           TEXT NOT NULL,
  short_name     TEXT NOT NULL,
  kind           lender_kind NOT NULL DEFAULT 'bank',
  headquarters   TEXT NOT NULL DEFAULT '',
  url            TEXT NOT NULL DEFAULT '',
  display_order  INTEGER NOT NULL DEFAULT 100,
  -- Soft delete. A lender that stops being compared must not take its rate
  -- history with it — past analyses referenced those rows.
  active         BOOLEAN NOT NULL DEFAULT true,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX lenders_display_idx ON lenders (display_order) WHERE active;

-- -----------------------------------------------------------------------------
-- mortgage_rates — one quoted rate
-- -----------------------------------------------------------------------------
CREATE TABLE mortgage_rates (
  id                TEXT PRIMARY KEY,
  lender_id         TEXT NOT NULL REFERENCES lenders (id) ON DELETE CASCADE,
  product_type      mortgage_product_type NOT NULL,
  -- Term in years: how long the rate is held. NOT the amortization.
  term_years        SMALLINT NOT NULL CHECK (term_years BETWEEN 1 AND 10),
  borrower_profile  borrower_profile NOT NULL,

  -- Nominal annual rate as a percentage: 4.79 means 4.79%. The upper bound is a
  -- guard against a feed that switches to fractions without telling anyone —
  -- 0.0479 would otherwise import silently and be wrong by a factor of a hundred.
  rate              NUMERIC(6, 3) NOT NULL CHECK (rate > 0 AND rate < 30),

  effective_date    DATE NOT NULL,
  data_source_id    TEXT NOT NULL REFERENCES data_sources (id),
  data_quality      rate_data_quality NOT NULL DEFAULT 'live',
  import_run_id     BIGINT REFERENCES import_runs (id) ON DELETE SET NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Re-running an import for the same day updates; a new day inserts.
  CONSTRAINT mortgage_rates_natural_key
    UNIQUE (lender_id, product_type, term_years, borrower_profile, effective_date)
);

-- The shape every read uses: newest first, within one lender/product/term/profile.
CREATE INDEX mortgage_rates_lookup_idx
  ON mortgage_rates (lender_id, product_type, term_years, borrower_profile,
                     effective_date DESC);

CREATE INDEX mortgage_rates_effective_idx ON mortgage_rates (effective_date DESC);

-- -----------------------------------------------------------------------------
-- The current rate table: latest row per lender, product, term and profile.
-- `PostgresMortgageRateRepository.listRates` runs this shape.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE VIEW latest_mortgage_rates AS
SELECT DISTINCT ON (lender_id, product_type, term_years, borrower_profile) *
  FROM mortgage_rates
 ORDER BY lender_id, product_type, term_years, borrower_profile, effective_date DESC;

COMMIT;

-- =============================================================================
-- Seeding the lenders
--
-- Safe to re-run. The rates themselves come from an import — see
-- docs/MORTGAGE_RATE_PIPELINE.md — because unlike the institutions, they change.
-- =============================================================================
INSERT INTO lenders (id, name, short_name, kind, headquarters, url, display_order)
VALUES
  ('rbc',           'Royal Bank of Canada',                 'RBC',           'bank',        'Toronto, Ontario',  'https://www.rbcroyalbank.com/mortgages/', 1),
  ('td',            'TD Canada Trust',                      'TD',            'bank',        'Toronto, Ontario',  'https://www.td.com/ca/en/personal-banking/products/mortgages', 2),
  ('bmo',           'Bank of Montreal',                     'BMO',           'bank',        'Montréal, Québec',  'https://www.bmo.com/main/personal/mortgages/', 3),
  ('scotiabank',    'Scotiabank',                           'Scotiabank',    'bank',        'Toronto, Ontario',  'https://www.scotiabank.com/ca/en/personal/mortgages.html', 4),
  ('cibc',          'Canadian Imperial Bank of Commerce',   'CIBC',          'bank',        'Toronto, Ontario',  'https://www.cibc.com/en/personal-banking/mortgages.html', 5),
  ('national-bank', 'National Bank of Canada',              'National Bank', 'bank',        'Montréal, Québec',  'https://www.nbc.ca/personal/mortgages.html', 6),
  ('desjardins',    'Desjardins Group',                     'Desjardins',    'cooperative', 'Lévis, Québec',     'https://www.desjardins.com/ca/personal/loans-credit/mortgages/', 7)
ON CONFLICT (id) DO UPDATE
  SET name          = EXCLUDED.name,
      short_name    = EXCLUDED.short_name,
      kind          = EXCLUDED.kind,
      headquarters  = EXCLUDED.headquarters,
      url           = EXCLUDED.url,
      display_order = EXCLUDED.display_order,
      updated_at    = now();

-- =============================================================================
-- Row Level Security (Supabase). Uncomment when deploying there.
-- =============================================================================
-- ALTER TABLE lenders         ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE mortgage_rates  ENABLE ROW LEVEL SECURITY;
-- CREATE POLICY public_read ON lenders        FOR SELECT USING (true);
-- CREATE POLICY public_read ON mortgage_rates FOR SELECT USING (true);
--
-- Writes come from the service role only. A rate anyone can write is a rate
-- nobody should trust.
