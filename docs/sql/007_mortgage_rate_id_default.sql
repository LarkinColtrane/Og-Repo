-- =============================================================================
-- Montreal Residential Market Intelligence — give mortgage_rates.id a default
--
-- Apply after 001–006:
--   psql "$DATABASE_URL" -f docs/sql/007_mortgage_rate_id_default.sql
--
-- Fixes an inconsistency found the first time this schema met a real server.
--
-- `mortgage_rates.id` is `TEXT PRIMARY KEY` with no DEFAULT, so every INSERT had
-- to invent an identifier:
--
--     null value in column "id" of relation "mortgage_rates"
--     violates not-null constraint
--
-- Every other table in this schema uses `BIGINT GENERATED ALWAYS AS IDENTITY`
-- and needs no such thing. Nothing has hit this yet only because no production
-- code writes to this table — mortgage rates are still generated, and the
-- licensed feed is `planned`. It would have surfaced on the first line of the
-- first rate importer somebody wrote, which is the worst moment to discover it.
--
-- Why a UUID default rather than switching to an identity column:
--
--  * The column type stays TEXT, so `MortgageRate.id` stays a string and nothing
--    downstream changes. Converting to BIGINT would be a destructive rewrite of
--    a table for no behavioural gain.
--
--  * The row's real identity is `mortgage_rates_natural_key` — (lender, product,
--    term, profile, effective_date) — which is what an upsert conflicts on. `id`
--    is a surrogate, and a surrogate does not need to be meaningful.
--
--  * `gen_random_uuid()` is built into PostgreSQL 13+, so no extension is needed.
--
-- NON-DESTRUCTIVE: adds a default to a column. Existing rows keep their ids.
-- =============================================================================

BEGIN;

ALTER TABLE mortgage_rates
  ALTER COLUMN id SET DEFAULT gen_random_uuid()::text;

COMMENT ON COLUMN mortgage_rates.id IS
  'Surrogate key. The row''s real identity is the natural key '
  '(lender_id, product_type, term_years, borrower_profile, effective_date), '
  'which is what an upsert conflicts on.';

COMMIT;

-- Rolling back:
--   ALTER TABLE mortgage_rates ALTER COLUMN id DROP DEFAULT;
