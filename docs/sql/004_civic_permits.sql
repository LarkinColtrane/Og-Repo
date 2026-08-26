-- =============================================================================
-- Montreal Residential Market Intelligence — civic data (construction permits)
--
-- Apply after 001, 002 and 003:
--   psql "$DATABASE_URL" -f docs/sql/004_civic_permits.sql
--
-- Adds the store for municipal building activity: construction, renovation and
-- demolition permits issued by the Ville de Montréal, aggregated to
-- borough-month totals.
--
-- Design notes:
--
--  * NON-DESTRUCTIVE. This migration only adds. It creates two tables and one
--    type, alters nothing that exists, and drops nothing. Applying it to a
--    database holding real market data cannot lose a row. That is a property to
--    preserve in every future migration here: additive changes can be rolled
--    forward on a live system, destructive ones need a maintenance window and a
--    backup somebody has actually tested restoring.
--
--  * A HISTORY, not a current value. One row per borough per month, forever, so
--    "how many permits did Verdun issue in March 2024?" stays answerable. A
--    table holding only the latest month would answer nothing worth asking.
--
--  * The natural key is (borough_code, period). That one constraint is what
--    makes re-running an import safe: the same month upserts in place rather
--    than doubling. Every write in the application goes through
--    ON CONFLICT DO UPDATE, and there is no DELETE path at all — see the note
--    on `civic_permit_stats` below.
--
--  * ROWS ARE AGGREGATES, NOT PERMITS. The publisher's records identify
--    specific addresses. Those are aggregated in the transform layer and never
--    reach this database. Storing address-level records and filtering on read
--    would mean the data was there to leak; not storing it means it is not.
--
--  * `borough_code` is OUR identifier ('le-sud-ouest'), not the publisher's
--    free-text name ('Le Sud-Ouest', 'LE SUD-OUEST', 'Arrondissement du
--    Sud-Ouest'). Normalization happens in lib/geo/montreal.ts before a row is
--    written, so joins are on a key rather than on a string that varies by
--    export.
--
--  * `period` is TEXT 'YYYY-MM', not a DATE. A month is a reporting bucket, not
--    an instant; storing it as a date would invite a timezone to decide which
--    month a row belongs to, and 2026-03-01 would sort correctly but read as a
--    specific day it is not.
--
--  * There is deliberately NO `permits_per_capita` or `share_of_city` column.
--    Both are derivable from what is here plus a population figure, and
--    materialising a derived value creates a second number to keep in step with
--    the first.
-- =============================================================================

BEGIN;

CREATE TYPE civic_data_quality AS ENUM ('live', 'demo');

-- -----------------------------------------------------------------------------
-- civic_permit_stats — one borough-month of permit activity
-- -----------------------------------------------------------------------------
CREATE TABLE civic_permit_stats (
  id                      BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,

  -- Our borough identifier, e.g. 'le-sud-ouest'. Resolved from the publisher's
  -- free text by normalizeBoroughName(), which returns null rather than
  -- guessing — so an unrecognised borough is a rejected row in the import
  -- report, never a row filed under the nearest match.
  borough_code            TEXT NOT NULL,

  -- Reporting month, 'YYYY-MM'.
  period                  TEXT NOT NULL
                          CHECK (period ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),

  -- Permits issued in the month.
  --
  -- The upper bound mirrors the application's Zod schema and exists for the
  -- same reason: Montréal's busiest boroughs issue a few hundred permits a
  -- month, so five figures can only mean a grouping bug or a date column that
  -- put a decade into one bucket. Wide enough never to reject a real month.
  permits_issued          INTEGER NOT NULL
                          CHECK (permits_issued >= 0 AND permits_issued <= 20000),

  -- Dwelling units the permits declare creating.
  --
  -- NULLABLE ON PURPOSE. NULL means "the extract carried no unit count"; 0
  -- means "the permits declared no new dwellings". Those are different facts
  -- and the interface renders them differently — defaulting the first to zero
  -- would publish a confident under-count.
  dwelling_units_created  INTEGER
                          CHECK (dwelling_units_created IS NULL
                                 OR (dwelling_units_created >= 0
                                     AND dwelling_units_created <= 50000)),

  -- Sum of declared work value, CAD. Nullable for the same reason.
  --
  -- This is a figure the APPLICANT states on the permit form, used to calculate
  -- the permit fee. It is not a measured construction cost and must never be
  -- presented as one. The ceiling is generous — a single institutional project
  -- can legitimately declare hundreds of millions — because its job is to catch
  -- a units error (cents stored as dollars), not to second-guess a real number.
  declared_work_value     NUMERIC(16, 2)
                          CHECK (declared_work_value IS NULL
                                 OR (declared_work_value >= 0
                                     AND declared_work_value <= 10000000000)),

  -- Permit counts by category, e.g.
  --   {"new-construction": 12, "renovation": 240, "demolition": 3, "other": 9}
  --
  -- JSONB rather than four columns because the publisher's category vocabulary
  -- is theirs and may grow. The application maps it onto four buckets and the
  -- validator enforces that they sum to permits_issued, which is the invariant
  -- that matters — a breakdown that does not add up is worse than none, because
  -- it looks authoritative.
  by_category             JSONB NOT NULL DEFAULT '{}'::jsonb,

  -- Data source id, resolvable in `data_sources`. Live rows carry the Ville de
  -- Montréal source; generated rows carry the demo source. A generated number
  -- attributed to a real publisher is the fabrication the whole provenance
  -- system exists to prevent, so this is NOT NULL.
  data_source_id          TEXT NOT NULL,

  -- When this was fetched from the publisher. Distinct from `period`, which is
  -- what the row describes. Conflating them loses the ability to answer "what
  -- did we know, and when?".
  retrieved_at            TIMESTAMPTZ NOT NULL,

  data_quality            civic_data_quality NOT NULL DEFAULT 'live',

  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- The natural key. This single constraint is what makes imports idempotent.
  CONSTRAINT civic_permit_stats_natural_key UNIQUE (borough_code, period)
);

COMMENT ON TABLE civic_permit_stats IS
  'Borough-month construction permit activity from Ville de Montréal open data. '
  'A permit is AUTHORISATION TO BUILD, not a completed dwelling: a permit issued '
  'in March is not a home anyone can live in in March, and some are never acted '
  'on. Rows are aggregates; address-level permit records are never stored. '
  'The application never DELETEs from this table — a re-import that omits a '
  'borough leaves that borough as it was, because "the extract did not mention '
  'Verdun" is not evidence that Verdun issued no permits.';

COMMENT ON COLUMN civic_permit_stats.declared_work_value IS
  'Value of the work as declared by the applicant for permit-fee purposes. '
  'A useful relative signal, a poor absolute one. Not a construction cost.';

COMMENT ON COLUMN civic_permit_stats.dwelling_units_created IS
  'NULL means the extract carried no unit count. 0 means no units were declared. '
  'These are different facts.';

-- The dominant read is "one borough, a range of months, ascending".
CREATE INDEX civic_permit_stats_borough_period_idx
  ON civic_permit_stats (borough_code, period);

-- The city-wide roll-up scans by period across every borough.
CREATE INDEX civic_permit_stats_period_idx
  ON civic_permit_stats (period);

-- Finding everything from one source matters when a source is corrected or
-- retired, and when the operations dashboard counts rows per source.
CREATE INDEX civic_permit_stats_source_idx
  ON civic_permit_stats (data_source_id);

-- -----------------------------------------------------------------------------
-- civic_geography — the borough registry, mirrored into the database
-- -----------------------------------------------------------------------------
--
-- lib/geo/montreal.ts is the authority: normalization happens in the
-- application, before a write. This table exists so that (a) borough_code has
-- something to reference, and (b) somebody querying the database directly can
-- resolve a code to a name without reading TypeScript.
--
-- The foreign key is added AFTER the seed insert below, so applying this
-- migration to a database that already holds permit rows cannot fail on a
-- borough the seed does not list.
CREATE TABLE civic_geography (
  code        TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  -- 'borough' for an arrondissement of the Ville de Montréal, 'linked-city' for
  -- an independent municipality in the agglomeration. Westmount is the second
  -- kind, and calling it a borough would be wrong.
  kind        TEXT NOT NULL CHECK (kind IN ('borough', 'linked-city')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE civic_geography IS
  'Montréal boroughs and linked cities. A BOROUGH IS NOT A NEIGHBOURHOOD: '
  'Griffintown and Saint-Henri are both inside Le Sud-Ouest, so a Sud-Ouest '
  'figure describes neither individually. The neighbourhood-to-borough mapping, '
  'with its per-neighbourhood coverage caveat, lives in lib/geo/montreal.ts and '
  'is deliberately not duplicated here — one authority, not two.';

INSERT INTO civic_geography (code, name, kind) VALUES
  ('ahuntsic-cartierville',                    'Ahuntsic-Cartierville',                    'borough'),
  ('anjou',                                    'Anjou',                                    'borough'),
  ('cote-des-neiges-notre-dame-de-grace',      'Côte-des-Neiges–Notre-Dame-de-Grâce',      'borough'),
  ('lachine',                                  'Lachine',                                  'borough'),
  ('lasalle',                                  'LaSalle',                                  'borough'),
  ('le-plateau-mont-royal',                    'Le Plateau-Mont-Royal',                    'borough'),
  ('le-sud-ouest',                             'Le Sud-Ouest',                             'borough'),
  ('l-ile-bizard-sainte-genevieve',            'L''Île-Bizard–Sainte-Geneviève',           'borough'),
  ('mercier-hochelaga-maisonneuve',            'Mercier–Hochelaga-Maisonneuve',            'borough'),
  ('montreal-nord',                            'Montréal-Nord',                            'borough'),
  ('outremont',                                'Outremont',                                'borough'),
  ('pierrefonds-roxboro',                      'Pierrefonds-Roxboro',                      'borough'),
  ('riviere-des-prairies-pointe-aux-trembles', 'Rivière-des-Prairies–Pointe-aux-Trembles', 'borough'),
  ('rosemont-la-petite-patrie',                'Rosemont–La Petite-Patrie',                'borough'),
  ('saint-laurent',                            'Saint-Laurent',                            'borough'),
  ('saint-leonard',                            'Saint-Léonard',                            'borough'),
  ('verdun',                                   'Verdun',                                   'borough'),
  ('ville-marie',                              'Ville-Marie',                              'borough'),
  ('villeray-saint-michel-parc-extension',     'Villeray–Saint-Michel–Parc-Extension',     'borough'),
  ('westmount',                                'Westmount',                                'linked-city')
ON CONFLICT (code) DO NOTHING;

-- Now that every known code exists, enforce the reference.
ALTER TABLE civic_permit_stats
  ADD CONSTRAINT civic_permit_stats_borough_fk
  FOREIGN KEY (borough_code) REFERENCES civic_geography (code);

-- -----------------------------------------------------------------------------
-- Register the source
-- -----------------------------------------------------------------------------
-- Left as 'planned' rather than 'active'. The pipeline exists but has never run
-- against the portal, and a registry that says 'active' for a connection nobody
-- has made is exactly the kind of quiet inaccuracy this project is built to
-- avoid. A successful import flips it.
INSERT INTO data_sources (id, name, source_type, url, status, licence, description, refresh_cadence)
VALUES (
  'src-montreal-permits',
  'Ville de Montréal construction permits',
  'open-data',
  'https://donnees.montreal.ca/dataset/permis-construction',
  'planned',
  'Creative Commons Attribution 4.0',
  'Construction, renovation and demolition permits issued by the Ville de Montréal, aggregated to borough-month totals.',
  'monthly'
)
ON CONFLICT (id) DO NOTHING;

COMMIT;

-- =============================================================================
-- Rolling back
--
--   BEGIN;
--   ALTER TABLE civic_permit_stats DROP CONSTRAINT civic_permit_stats_borough_fk;
--   DROP TABLE civic_permit_stats;
--   DROP TABLE civic_geography;
--   DROP TYPE civic_data_quality;
--   DELETE FROM data_sources WHERE id = 'src-montreal-permits';
--   COMMIT;
--
-- Stated so the rollback is a decision rather than an improvisation at the
-- worst possible moment. It destroys every imported permit statistic; that is
-- what rolling back this migration means, and it should be read before it is
-- run rather than after.
-- =============================================================================
