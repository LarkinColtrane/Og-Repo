# Database schema

The tables this application is designed around. The executable version is
[`sql/001_initial_schema.sql`](./sql/001_initial_schema.sql); this document
explains the reasoning, which the DDL cannot.

Nothing in the running app touches a database yet — it is served from the
generated demo dataset. The schema is written first because the demo dataset was
shaped to match it, so the switch is a change of source rather than a rewrite.

---

## Overview

```
data_sources ──────┬──────────────────────────────────┐
      │            │                                  │
      │            ▼                                  ▼
      │    sale_market_stats               rental_market_stats
      │            │                                  │
      │            └────────────┬─────────────────────┘
      │                         ▼
      │                  neighbourhoods ──── neighbourhood_boundaries
      ▼
 import_runs
```

Two fact tables (`sale_market_stats`, `rental_market_stats`), one dimension
(`neighbourhoods`), and two operational tables that make the facts trustworthy
(`data_sources`, `import_runs`).

---

## `neighbourhoods`

| Column | Type | Notes |
|---|---|---|
| `id` | `TEXT` PK | Stable string id, e.g. `nbh-plateau-mont-royal`. |
| `name` | `TEXT` | Display name. |
| `slug` | `TEXT` UNIQUE | URL segment. Also the join key between feeds. |
| `borough` | `TEXT` | Arrondissement or linked city. |
| `latitude` / `longitude` | `NUMERIC(9,6)` | Approximate centroid. |
| `profile` | `TEXT` | Neutral description of location and built form. |
| `dwelling_stock` | `JSONB` | `{"condo": 12000, "house": 900, "plex": 14000}` |

**Why a `TEXT` id rather than a serial.** These rows are referenced from
configuration, fixtures and import mappings. A readable id makes those legible
and survives a database rebuild; a serial would silently renumber.

**Why `profile` is not a market description.** Anything of the form "strong
demand" or "prices rising" is a claim that goes stale the moment the data moves,
and nothing in the system would notice. Market prose is generated from the
statistics instead (`lib/calculations/summary.ts`). This column holds only
things that do not change month to month — where the area is and what it is
built out of.

**Why `dwelling_stock` is JSONB.** It is a weighting input, not something to
query or join on, and the property-type keys track the `property_type` enum. A
child table would be more normalised and would buy nothing.

---

## `sale_market_stats`

One row per **neighbourhood × property type × month**.

| Column | Type | Notes |
|---|---|---|
| `id` | `BIGINT` identity PK | |
| `neighbourhood_id` | `TEXT` FK | |
| `period` | `DATE` | First day of the month. CHECK-enforced. |
| `property_type` | `property_type` enum | `condo` / `house` / `plex` |
| `median_price` | `NUMERIC(12,2)` | |
| `average_price_per_sqft` | `NUMERIC(10,2)` | Nullable — not every feed reports area. |
| `active_listings` | `INTEGER` | End of period. |
| `new_listings` | `INTEGER` | During period. |
| `sales_count` | `INTEGER` | Completed during period. |
| `average_days_on_market` | `INTEGER` | |
| `listing_to_sale_ratio` | `NUMERIC(6,2)` | Percent. Over 100 = sold above asking. |
| `yoy_change` | `NUMERIC(6,2)` | Percent vs the same month last year. Nullable. |
| `data_source_id` | `TEXT` FK NOT NULL | |
| `import_run_id` | `BIGINT` FK | Which run wrote this row. |

**UNIQUE `(neighbourhood_id, period, property_type)`** — the natural key. This
one constraint is what makes imports idempotent: `ON CONFLICT … DO UPDATE` turns
a re-run into a refresh instead of a duplicate. Without it, running a job twice
doubles every count and nothing complains.

**`period` as a first-of-month `DATE`.** Postgres has no month type. Storing a
date with a `CHECK (date_part('day', period) = 1)` gets date arithmetic
(`period - INTERVAL '1 year'` for the YoY join) while making the convention
impossible to violate quietly.

**`yoy_change` stored, not computed.** Deriving it on read means a self-join on
every query. Storing it lets the import own the definition and recompute it in
one pass — and a backfill of older months automatically fills in YoY figures that
were previously `NULL`.

**Nullable means unknown, never zero.** A suppressed CMHC cell, a month with no
sales, a series too young for a year-over-year comparison — all `NULL`. Writing
`0` for any of them would drag every average toward zero and be indistinguishable
from a real measurement.

---

## `rental_market_stats`

One row per **neighbourhood × bedroom type × month**.

| Column | Type | Notes |
|---|---|---|
| `id` | `BIGINT` identity PK | |
| `neighbourhood_id` | `TEXT` FK | |
| `period` | `DATE` | First day of the month. |
| `bedroom_type` | `bedroom_type` enum | `studio` / `oneBedroom` / `twoBedroom` / `threeBedroom` |
| `average_rent` | `NUMERIC(10,2)` | |
| `median_rent` | `NUMERIC(10,2)` | Nullable — CMHC does not publish it everywhere. |
| `vacancy_rate` | `NUMERIC(5,2)` | Percent, 0–100. |
| `yoy_change` | `NUMERIC(6,2)` | Percent change in `average_rent`. |
| `data_source_id` | `TEXT` FK NOT NULL | |
| `import_run_id` | `BIGINT` FK | |

**Percent, not fraction.** `1.8` means 1.8%. Mixing the two conventions is the
most common source of hundred-fold errors in this kind of dataset, so the column
comment and the Zod schema both say so, and the range check (`0–100`) catches a
fraction written by mistake.

**A monthly grain for an annual survey.** CMHC's Rental Market Survey is annual
(October), with a semi-annual update. Storing it monthly keeps one grain across
both fact tables; the importer decides whether to repeat the October figure
across the year or leave intervening months empty. Whichever it does should be
recorded in `data_sources.description`, because a chart reader cannot tell the
difference by looking.

---

## `data_sources`

| Column | Type | Notes |
|---|---|---|
| `id` | `TEXT` PK | e.g. `src-cmhc-rms` |
| `name` | `TEXT` | Shown in the source badge. |
| `source_type` | enum | `demo` / `open-data` / `government` / `licensed` / `manual` / `derived` |
| `url` | `TEXT` | Where it came from. |
| `description` | `TEXT` | Including any methodology caveats. |
| `licence` | `TEXT` | Redistribution terms. |
| `refresh_cadence` | enum | How often upstream publishes. |
| `status` | enum | `active` / `planned` / `stale` / `error` |
| `last_updated` | `TIMESTAMPTZ` | Last **successful** import. |

`source_type = 'demo'` is what drives the "Demo data · Not live market data"
badge. It is a data-level flag, not a UI setting, so a synthetic figure cannot be
presented as a real one by forgetting a prop.

`licence` is not decorative. Licensed listing data typically forbids
republishing individual transactions; storing the terms beside the data is what
lets you answer "are we allowed to show this" without going back to a contract.

---

## `import_runs`

| Column | Type | Notes |
|---|---|---|
| `id` | `BIGINT` identity PK | |
| `data_source_id` | `TEXT` FK | |
| `started_at` / `completed_at` | `TIMESTAMPTZ` | |
| `status` | enum | `running` / `success` / `failed` / `partial` |
| `records_imported` | `INTEGER` | |
| `error_message` | `TEXT` | |
| `triggered_by` | enum | `schedule` / `manual` / `webhook` |
| `metadata` | `JSONB` | URL fetched, row counts, anything useful later. |

This table answers "when did this number last change, and why" — the first
question anyone asks when a figure looks wrong, and one you cannot answer
retroactively. `partial` exists because an import that loaded 90% of its rows is
neither a success nor a failure, and calling it either loses information.

---

## `neighbourhood_boundaries`

| Column | Type | Notes |
|---|---|---|
| `neighbourhood_id` | `TEXT` PK / FK | |
| `feature` | `JSONB` | GeoJSON Feature, WGS 84. |
| `data_source_id` | `TEXT` FK | |

Separate from `neighbourhoods` because geometry is large, changes on its own
schedule, and almost no query needs it. While the table is empty the market map
renders a schematic tile grid and says so, rather than drawing an approximated
outline — a shape that looks like a map is read as geography whatever the caption
says.

With PostGIS available, `geometry(MultiPolygon, 4326)` plus a GiST index is the
better column type; JSONB keeps the schema portable to plain Postgres.

---

## Queries the application actually runs

Every read is in `lib/data/postgres-repository.ts`. The three shapes:

**Latest snapshot for a dashboard**
```sql
SELECT * FROM latest_sale_stats WHERE neighbourhood_id = $1;
```
Served by the `latest_sale_stats` view (`DISTINCT ON`), which uses
`sale_stats_lookup_idx` and does not scan history.

**A trend series for a chart**
```sql
SELECT period, median_price
  FROM sale_market_stats
 WHERE neighbourhood_id = $1 AND property_type = $2
   AND period >= $3 AND period <= $4
 ORDER BY period;
```
The leading columns of `sale_stats_lookup_idx` match this exactly.

**A city-wide roll-up**
```sql
SELECT * FROM sale_market_stats WHERE period = $1;
```
Uses `sale_stats_period_idx`. Twelve neighbourhoods × three property types is 36
rows; when this grows past a few hundred, materialise it into a
`city_market_stats` table written by the same import that fills the fact tables,
rather than aggregating on read.

---

## Changes to expect

- **`property_listings`** — if a licensed feed is added, transaction-level rows
  land in their own table and the aggregates become a materialised roll-up
  rather than the source of truth.
- **`property_assessments`** — the municipal assessment roll, keyed by lot
  number. This is the first table the property analyzer needs.
- **`city_market_stats`** — precomputed Montréal-wide figures, once computing
  them on read stops being free.
