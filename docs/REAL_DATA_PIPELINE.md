# Following one number, all the way

This document traces a **single statistic** from a municipal open-data portal to
a figure on a page in this application. Every stage, in order, with the actual
file that does it.

If you read one document about how this platform handles real data, read this
one. It is written for someone who has never built a data pipeline.

---

## The example we will follow

> **Le Sud-Ouest issued 105 construction permits in May 2026.**

That sentence is the destination. By the end you will know exactly which lines
of code produced each part of it — the *105*, the *Le Sud-Ouest*, and the
*May 2026* — and, just as importantly, what stops the application printing it
when it is not true.

---

## The stages

```
  ①  Ville de Montréal open-data portal        an HTTP endpoint on the internet
        │
  ②  RAW RESPONSE                              JSON, their column names, one row per permit
        │      lib/pipeline/connectors/montreal-open-data/client.ts
  ③  SCHEMA RESOLUTION                         "which column is the borough?"
        │      lib/pipeline/connectors/montreal-open-data/datasets.ts
  ④  NORMALIZED RECORD                         our shape, our borough codes, monthly buckets
        │      lib/pipeline/transforms/montreal-permits.ts
  ⑤  VALIDATED RECORD                          checked, or rejected with a reason
        │      lib/pipeline/validate.ts
  ⑥  DATABASE ROW                              one row per (borough, month), upserted
        │      lib/data/postgres-civic-repository.ts
  ⑦  REPOSITORY OBJECT                         typed, back in our shape
        │      lib/data/civic-service.ts
  ⑧  API JSON                                  our own endpoint, with provenance
        │      app/api/civic/permits/route.ts
  ⑨  A NUMBER ON A PAGE                        with a label it cannot lie about
               components/civic/building-activity.tsx
```

Nine stages sounds like a lot for one number. Each exists because of a specific
way pipelines go wrong, and each is named below.

---

## ① The source

**Ville de Montréal open data**, at `donnees.montreal.ca`.

| | |
|---|---|
| **Dataset** | Construction permits (`permis-construction`) |
| **API** | CKAN Action API — the same software behind `open.canada.ca` and hundreds of municipal portals |
| **Authentication** | None. Open data, no key |
| **Licence** | Creative Commons Attribution 4.0 |
| **Scraping** | Not used, not needed. This is the publisher's own machine-readable API |

Two requests are involved:

```bash
# What is in this dataset? Which of its files can be queried?
curl "https://donnees.montreal.ca/api/3/action/package_show?id=permis-construction"

# Give me rows.
curl "https://donnees.montreal.ca/api/3/action/datastore_search?resource_id=<uuid>&limit=1000&offset=0"
```

### Why two requests and not one

The `resource_id` is a UUID the portal assigns. It is **not** hard-coded
anywhere in this repository, and that is deliberate: if the city re-uploads the
file, the UUID changes, and a pinned one would break silently. So the pipeline
asks the dataset which of its files is queryable, every run. One extra request
buys immunity to a whole class of breakage.

> ### ⚠️ Honest limitation
>
> **This pipeline has never run against the live portal.** Outbound access to
> `donnees.montreal.ca` is blocked by the egress policy of the environment it
> was built in — the gateway answers `403` to the connection attempt. That was
> reported rather than worked around.
>
> Everything below is built against the documented CKAN API and tested with
> fixtures. What that proves and does not prove is set out in
> [§ What is and is not verified](#what-is-and-is-not-verified).

---

## ② The raw response

CKAN wraps every answer in the same envelope:

```jsonc
{
  "help": "https://donnees.montreal.ca/api/3/action/help_show?name=datastore_search",
  "success": true,
  "result": {
    "resource_id": "bbbbbbbb-2222-…",
    "fields": [
      { "id": "_id",              "type": "int4"    },
      { "id": "arrondissement",   "type": "text"    },
      { "id": "date_emission",    "type": "text"    },
      { "id": "nature_travaux",   "type": "text"    },
      { "id": "valeur_travaux",   "type": "numeric" },
      { "id": "nombre_logements", "type": "int4"    }
    ],
    "records": [
      {
        "_id": 1,
        "arrondissement": "Le Sud-Ouest",
        "date_emission": "2026-05-14",
        "nature_travaux": "Rénovation intérieure",
        "valeur_travaux": 85000,
        "nombre_logements": 0
      }
      // … 104 more rows for this borough and month
    ],
    "total": 41287
  }
}
```

Three things to notice, each of which the next stages exist to handle:

1. **One row is one permit**, not one statistic. Our 105 is 105 of these rows.
2. **The columns are French and theirs.** `arrondissement`, not `borough`.
3. **`success` is inside the body.** CKAN answers `200 OK` and puts the failure
   in the payload. Checking only the HTTP status is the classic mistake against
   this API — so `client.ts` checks `success` explicitly, and a `false` becomes a
   thrown, classified error.

### Paging

41 287 rows do not arrive at once. The connector loops, 1 000 rows at a time,
and stops when a page comes back **shorter than requested** or **empty** —
rather than trusting `total`. Trusting `total` alone is how a paging bug becomes
an infinite loop against somebody else's free server.

---

## ③ Schema resolution — the stage most pipelines skip

Here is the tempting version of the next step:

```ts
const borough = record.arrondissement;   // ← don't
```

It works until the city renames the column. Then it produces `undefined` for
every row, every borough becomes "unknown", every total becomes zero — and the
import *reports success*, because nothing threw. You find out weeks later when
somebody notices the chart went flat.

So instead, each field the pipeline needs is **declared**, with the column names
it will accept, in `datasets.ts`:

```ts
{
  logical: "borough",
  candidates: ["arrondissement", "nom_arrondissement", "arrondissement_nom", "borough"],
  required: true,
  description: "Borough the permit was issued in. Normalized through lib/geo/montreal.ts…",
}
```

Before a single row is read, `resolveFields()` matches that declaration against
the columns the response actually carried. Matching folds accents and case, so
`DATE_ÉMISSION` and `date_emission` are the same column.

If a **required** field matches nothing, the import stops with `schema-mismatch`
and a report you can act on:

```
The "Ville de Montréal construction permits" resource does not carry the columns
this pipeline requires. Missing: borough (tried: arrondissement, nom_arrondissement,
arrondissement_nom, borough). Columns actually present: _id, secteur, jour.
Nothing was written. Update the field contract in
lib/pipeline/connectors/montreal-open-data/datasets.ts to match.
```

**Nothing is written.** That last sentence is the point of the whole stage: the
pipeline either works on real data or explains precisely why it cannot. It never
produces confident nonsense.

This also converts our unverified column names from a hidden guess into a
self-reporting assumption — see the limitation note in §1.

---

## ④ Normalization — where the number becomes ours

`lib/pipeline/transforms/montreal-permits.ts` is a **pure function**: rows in,
records out, no network, no database, no clock. That makes it trivially testable
and means the same input always gives byte-identical output.

It does four things.

### 4a. Resolve the geography

```
"Le Sud-Ouest"                     ─┐
"LE SUD-OUEST"                      ├─→  le-sud-ouest
"Arrondissement du Sud-Ouest"      ─┘
"Laval"                            ───→  null  →  row rejected
```

`normalizeBoroughName()` in `lib/geo/montreal.ts` folds accents, case and every
kind of dash, strips an `Arrondissement de` prefix, and looks the result up in a
registry of the 19 boroughs and the linked cities.

**It returns `null` rather than guessing.** No fuzzy matching, no nearest
neighbour. "Laval" is a different city; a matcher clever enough to find
"Lachine" three edits away would be a matcher that silently files Laval's
permits under a Montréal borough. An unrecognised name becomes a rejected row
that appears in the import report, where somebody can look at it.

Why a **code** and not the name? Because free text is not a key. Joining tables
on `"Le Sud-Ouest"` breaks the moment one export writes it differently, and it
breaks by *dropping rows* — the total still looks plausible, which is the worst
kind of bug.

### 4b. Bucket the date to a month

`2026-05-14` → `2026-05`.

The application reports monthly, so a permit's issue date becomes a reporting
period. `Period` is the string `"2026-05"`, deliberately not a `Date`: a month is
a bucket, not an instant, and making it a `Date` invites a timezone to decide
which month a row belongs to.

> **`03/04/2026` is rejected, not parsed.**
>
> It is 3 April in Québec and 4 March in the United States. Both readings give a
> *different month*, and everything here is bucketed by month — so guessing wrong
> does not shift a statistic slightly, it files it under the wrong period. A
> parser cannot resolve that from the value alone, so the row is rejected with a
> message explaining the ambiguity, and a person decides. ISO dates
> (`2026-05-14`) and `25/12/2026` (first component above 12, so unambiguously a
> day) are accepted.

### 4c. Aggregate

105 permit rows collapse into **one** record:

```ts
{
  boroughCode: "le-sud-ouest",
  period: "2026-05",
  permitsIssued: 105,
  dwellingUnitsCreated: 18,
  declaredWorkValue: 12_400_000,
  byCategory: { "new-construction": 7, renovation: 91, demolition: 3, other: 4 },
  dataSourceId: "src-montreal-permits",
  retrievedAt: "2026-08-26T12:00:00.000Z",
  dataQuality: "live",
}
```

Aggregating **here**, in the transform, rather than on read is deliberate. Each
source row identifies a specific address. This platform has no use for
address-level records — everything it shows is borough or neighbourhood scale —
so they never reach storage at all, instead of being stored and then filtered
out later. Data you did not keep cannot leak.

### 4d. Distinguish "no value" from "zero"

```ts
readNumber("")      // → null,  NOT 0
readNumber("0")     // → 0
readNumber("n/a")   // → null
readNumber("1 234,56")  // → 1234.56   (French decimal comma)
readNumber("1,234.56")  // → 1234.56   (English thousands comma)
```

`Number("")` is `0` in JavaScript. That single fact is how an empty cell becomes
a confident zero in every naive importer ever written. Here, an empty column
gives `null`, which travels all the way to the interface and renders as **"Not
reported"** rather than a **0** somebody might quote.

---

## ⑤ Validation — the gate

`lib/pipeline/validate.ts`. Two levels.

### Per row

| Check | Why |
|---|---|
| `boroughCode` is in the registry | A code we cannot resolve is a code we cannot label |
| `period` matches `YYYY-MM` | The upsert key must be well formed |
| `permitsIssued` ≤ 20 000 | Montréal's busiest borough issues hundreds a month. Five figures means a grouping bug or a decade in one bucket |
| Category counts **sum to** `permitsIssued` | A breakdown that does not add up is worse than none — it looks authoritative |
| `(borough, period)` is unique in the batch | It is the upsert key; two rows would let write order decide the stored value |

Rejected rows do not fail the import. They are returned with reasons, the good
rows are written, and the run is recorded as **`partial`** — not `success`. A run
that says "success" while discarding a tenth of the source is how a slow feed
regression goes unnoticed for months.

### Per batch

Some faults are invisible one row at a time.

```
detectPermitBatchAnomaly()
  → any period beyond next month?     → refuse the WHOLE batch
  → zero permits across every row?    → refuse the WHOLE batch
```

A permit cannot be issued in the future. A batch containing 2031 is not a batch
with one bad row — it is the signature of a **misread date column**, and if the
parse is wrong then the rows that happen to look sane are not trustworthy
either. So the whole batch is refused and nothing is written.

---

## ⑥ The database row

`docs/sql/004_civic_permits.sql`, written by
`lib/data/postgres-civic-repository.ts`.

```sql
INSERT INTO civic_permit_stats
  (borough_code, period, permits_issued, dwelling_units_created,
   declared_work_value, by_category, data_source_id, retrieved_at, data_quality)
SELECT * FROM unnest($1::text[], $2::text[], …)
ON CONFLICT (borough_code, period) DO UPDATE
  SET permits_issued = EXCLUDED.permits_issued,
      …
      updated_at = now();
```

### The one constraint everything rests on

```sql
CONSTRAINT civic_permit_stats_natural_key UNIQUE (borough_code, period)
```

That is what makes re-running an import **safe**. Import May 2026 twice and you
get one row, not two. It is why the scheduler can re-fetch an overlapping window
every night without the data doubling, and why a failed run can simply be run
again.

### The rule about deletion

**There is no `DELETE` anywhere in this repository class.** Not in a cleanup
path, not in a "replace the month" helper. None.

Here is why that matters. Imagine a nightly import where the publisher's export
was truncated and came back with only three boroughs instead of twenty. A
pipeline that treats absence as deletion would remove seventeen boroughs of
history that night. But *"the extract did not mention Verdun"* is not evidence
that Verdun issued no permits — it is far more likely that the extract was
filtered, truncated, or broken.

So imports only ever **add or update**. A month nobody mentioned stays exactly as
it was. `tests/civic-ingest.test.ts` asserts this against a schema mismatch, a
corrupted batch, an empty extract, a partial extract and an upstream outage —
five ways an import can go wrong, five times the history survives intact.

---

## ⑦ The repository object

`getPermitSeries()` in `lib/data/civic-service.ts` reads the rows back and turns
them into what the interface needs.

One detail worth knowing: PostgreSQL's `numeric` type comes back from the driver
as a **string**, because it does not always fit in a JavaScript number. The
mapper converts every numeric column explicitly rather than trusting it to be a
number three layers up.

This layer also composes the caption — see the next section, which is the most
important idea in this document.

---

## ⑧ The API

`GET /api/civic/permits?neighbourhood=griffintown&months=36`

```jsonc
{
  "data": {
    "boroughCode": "le-sud-ouest",
    "boroughName": "Le Sud-Ouest",
    "observations": [ { "period": "2026-05", "permitsIssued": 105, … } ],
    "city": [ … ],
    "attribution": {
      "neighbourhoodSlug": "griffintown",
      "boroughCode": "le-sud-ouest",
      "label": "Le Sud-Ouest",
      "qualifier": "Borough-wide figure — wider than this neighbourhood",
      "note": "Griffintown is one part of the borough of Le Sud-Ouest. Borough figures also cover Saint-Henri, Pointe-Saint-Charles, Ville-Émard and Côte-Saint-Paul.",
      "coverage": "part-of"
    }
  },
  "meta": {
    "generatedAt": "2026-08-26T12:00:00.000Z",
    "dataQuality": "demo",
    "period": "2026-05",
    "sources": [ { "sourceId": "src-demo-permits", "sourceName": "Demo construction permits", "isDemo": true } ]
  }
}
```

### The browser never talks to the city

The page requests **our** endpoint, which serves what the pipeline stored. That
means the portal is contacted once per import rather than once per visitor, the
page keeps working when the portal is down, and changing upstream is a change to
one connector rather than to every component.

### `attribution` — a borough is not a neighbourhood

This is the part to read twice.

> **Griffintown does not publish permit counts. Le Sud-Ouest does.**
>
> And Le Sud-Ouest also contains Saint-Henri, Pointe-Saint-Charles, Ville-Émard
> and Côte-Saint-Paul.

So when you ask for Griffintown, what comes back is a **Le Sud-Ouest** figure,
plus an `attribution` object that says so in words.

That caption is composed **here, in the service layer**, from the coverage
recorded in `lib/geo/montreal.ts` — never in a page. The component renders
`attribution.label`, which is the *borough's* name. A component that wrote its
own heading could print "Griffintown: 105 permits", which would be a **fabricated
statistic**. This one cannot, because it has no way to.

It is the same discipline as `dataQuality` living in the repository instead of a
component prop: **a label that can be forgotten will be forgotten.**

Ask for Saint-Henri and you get the identical numbers with a different note —
one naming Griffintown instead. Two neighbourhoods, one borough, one honest
figure shown twice.

Verdun is the other case. There the neighbourhood and the borough are
substantially the same territory, so `coverage` is `"coextensive"` and no
"wider than" warning appears. Westmount is a third: an independent municipality,
not a borough at all, so its qualifier reads "City-wide figure".

---

## ⑨ The number on the page

`components/civic/building-activity.tsx`, on every neighbourhood page and on
`/buy`.

```
┌─────────────────────────────────────────────────────────────────┐
│ Building activity                            [Total|By type] [3Y]│
│ Le Sud-Ouest                                                     │
│ Demonstration figures — generated by this application and        │
│ never published by anyone. …                                     │
├─────────────────────────────────────────────────────────────────┤
│ ┌───────────────────────────────────────────────────────────┐   │
│ │ [Borough figure]  Griffintown is one part of the borough   │   │
│ │ of Le Sud-Ouest. Borough figures also cover Saint-Henri,   │   │
│ │ Pointe-Saint-Charles, Ville-Émard and Côte-Saint-Paul.     │   │
│ └───────────────────────────────────────────────────────────┘   │
│                                                                  │
│  Permits issued     Dwelling units      Declared work value      │
│       105            declared 18            $12.4M               │
│      May 2026                                                    │
│                                                                  │
│  ▁▂▄▆█▇▅▃▂▄▆█  ← permits per month                              │
│                                                                  │
│ A permit is authorisation to build, not a finished home. …       │
│ ● Demo data · Not live market data                               │
└─────────────────────────────────────────────────────────────────┘
```

Four labels on that card cannot be forgotten, because none of them is written by
the page:

| Label | Comes from |
|---|---|
| `Le Sud-Ouest` | `attribution.label`, composed in the service layer |
| The borough caveat | `attribution.note`, from the geography registry |
| `Demo data` | `isDemo` on the `Attribution`, from the source registry |
| The demo description | `meta.dataQuality`, from the repository |

### A permit is not a home

The caution at the bottom is the same shape as *"a bond yield is not a mortgage
rate"* on the investor page. The number is real and worth showing, and it
measures something adjacent to what a reader will assume:

- A **permit** is authorisation to build. Work takes months or years, and some
  permits are never acted on. A permit issued in March is not a home anyone can
  live in in March.
- **Declared work value** is a figure the applicant states on the form to
  calculate the permit fee. A useful relative signal — a borough whose declared
  value doubles is doing more building — and a poor absolute one.

---

## Mixed data quality

The platform has **four** independent data stores:

| Repository | Data | Becomes live when |
|---|---|---|
| `MarketDataRepository` | prices, rents | a market source is licensed |
| `MortgageRateRepository` | lender rates | a rate feed is licensed |
| `MarketBenchmarkRepository` | bond yields | the Bank of Canada import runs |
| `CivicDataRepository` | permits | the Montréal import runs |

They will not become live on the same day, and that is the point of them being
separate. Each carries its own `dataQuality`.

**A single live dataset must never make unrelated demo statistics look
verified.** Three mechanisms enforce that:

1. **`Attribution.isDemo`, per statistic.** The source badge reads the flag on
   the data, not a prop. A live permit count and a demo median price on the same
   page get different badges automatically.
2. **`meta.datasets`, per response.** A response carrying more than one kind of
   data reports each separately.
3. **`meta.dataQuality` is derived, not declared.** `combineDataQuality()`
   returns `live` only when *every* dataset is live, `mixed` when some are, and
   `demo` otherwise. A route cannot claim more than it has, because it does not
   get to set the value.

The `/data-sources` page shows this as a table, one row per dataset.

---

## When it fails

Every failure mode, and what the system does:

| Failure | `errorKind` | What happens |
|---|---|---|
| Portal unreachable | `network` | Run recorded failed. Nothing written |
| Portal slow | `timeout` | Abandoned after 20s. Run recorded |
| Blocked by a proxy | `http` | Message says a 403 on an open portal is probably an egress policy |
| `200` with `success: false` | `http` | Treated as a refusal, not a success |
| Column renamed | `schema-mismatch` | Report naming expected vs actual columns. Nothing written |
| Dataset has no queryable file | `no-queryable-resource` | Reported. Nothing written |
| Every row unusable | `no-usable-rows` | Reported with the first reason |
| Dates in the future | `batch-anomaly` | Whole batch refused. Nothing written |
| Store refuses the write | `persistence` | Reported. **Loud, not silent** |
| Some rows bad | `partial-validation` | Good rows written, run recorded `partial` |
| Empty extract | `empty-extract` | Recorded `partial`. **History untouched** |

**Every one of these records an import run**, success or failure. That is the
contract the whole pipeline is built around, and it is what makes *"nothing has
succeeded since March"* a question the system can answer, rather than something
somebody eventually notices.

Failures then flow into the health engine (`lib/pipeline/health.ts`) and the
alerting layer — two consecutive failures or stale data raises an incident. See
[AUTOMATION.md](./AUTOMATION.md).

---

## What is and is not verified

Being precise about this matters more than sounding finished.

### Proven

- The CKAN envelope, paging, and every error path — tested against fixtures,
  including the `200`-with-`success:false` case and a `403`.
- Schema resolution, including the **failure** case: a renamed column produces a
  clear report and writes nothing.
- Borough normalization across accents, dashes, casing and prefixes, and that an
  outside city returns `null` instead of a near match.
- Date parsing, including that an ambiguous format is refused.
- Aggregation, category totals, and null-vs-zero handling.
- Every validation rule, per row and per batch.
- Upsert idempotency, and that **five different kinds of bad import cannot erase
  history**.
- That a borough figure is never captioned with a neighbourhood name — asserted
  in unit tests, in HTTP tests, and in a browser.

### Not proven

- **The column names.** They come from documentation, not a live response.
  `MONTREAL_PERMITS.fieldsVerified` is `false` and the data-source registry says
  `planned`. The first real import will either work or fail with a
  `schema-mismatch` naming the actual columns — which is precisely the list
  needed to correct the contract.
- **That the SQL is syntactically valid.** There is no database here. The
  repository is tested against a fake executor that reproduces upsert semantics,
  which proves the logic, not the syntax.
- **That the live dataset behaves as expected** — its real size, cadence and
  data quality.

None of these can be closed from an environment that cannot reach the portal,
and none was papered over. The dashboard at `/data-sources` reports the pipeline
as **not connected**, because it is not.

---

## Connecting it for real

From a host with outbound access to `donnees.montreal.ca`:

```bash
# 1. A database
psql "$DATABASE_URL" -f docs/sql/001_initial_schema.sql
psql "$DATABASE_URL" -f docs/sql/002_mortgage_rates.sql
psql "$DATABASE_URL" -f docs/sql/003_market_benchmarks.sql
psql "$DATABASE_URL" -f docs/sql/004_civic_permits.sql

# 2. Point the factory at it — lib/data/index.ts, getCivicRepository()

# 3. A backfill, bounded so the first run cannot surprise you
curl -X POST https://your-host/api/internal/market-data/montreal-permits \
  -H "Authorization: Bearer $MARKET_INGEST_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"from": "2020-01", "maxRecords": 5000}'
```

Read the response before scheduling anything. If it reports `schema-mismatch`,
the message lists the columns the resource actually has: put them in
`candidates` in `datasets.ts`, set `fieldsVerified: true`, and run it again.

Then add it to the schedule — monthly, since the data is:

```
0 6 5 * *   # 06:00 on the 5th, giving the city time to publish the prior month
```

pointed at `/api/internal/market-data/scheduled?pipelines=civic`. See
[AUTOMATION.md](./AUTOMATION.md).

---

## The files, in one list

| Stage | File |
|---|---|
| ① Source registry | `data/demo/sources.ts` |
| ② Connector | `lib/pipeline/connectors/montreal-open-data/client.ts` |
| ③ Field contract | `lib/pipeline/connectors/montreal-open-data/datasets.ts` |
| ③ Geography | `lib/geo/montreal.ts` |
| ④ Normalizer | `lib/pipeline/transforms/montreal-permits.ts` |
| ⑤ Validation | `lib/pipeline/validate.ts` |
| — Orchestration | `lib/pipeline/ingest/montreal-permits.ts` |
| ⑥ Schema | `docs/sql/004_civic_permits.sql` |
| ⑥ Repository | `lib/data/postgres-civic-repository.ts`, `lib/data/demo-civic-repository.ts` |
| ⑦ Service | `lib/data/civic-service.ts` |
| ⑧ Public API | `app/api/civic/permits/route.ts` |
| — Ingest API | `app/api/internal/market-data/montreal-permits/route.ts` |
| ⑨ Interface | `components/civic/building-activity.tsx` |
| — Health | `lib/pipeline/health.ts`, `lib/pipeline/monitor.ts` |
| — Tests | `tests/geo.test.ts`, `tests/civic-*.test.ts` |
