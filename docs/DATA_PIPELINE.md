# Data pipeline

How real data gets into this application, and where each piece of that work
belongs. Nothing described here is running yet — the app is served from a
generated demo dataset. This document is the map for replacing it.

---

## 1. The shape of the thing

```
External sources          Transport            Storage        Serving
─────────────────         ─────────            ───────        ───────
CMHC ─────────────┐
Montréal Open Data├──►  connector  ──► transform ──► validate ──► PostgreSQL ──► internal API ──► pages
Données Québec    │     (fetch)        (map to      (reject      (upsert +      (/api/...)      (React)
Statistics Canada │                     our types)   bad rows)    audit row)
Licensed listings ┘
                          ▲
                          │
                    scheduler (cron / n8n / Vercel Cron)
```

Five stages, each with one job:

| Stage | Job | Lives in |
|---|---|---|
| **Connector** | Fetch bytes from one upstream source. Knows about HTTP, auth, pagination, CSV vs JSON. Knows nothing about our schema. | `lib/pipeline/connectors/` |
| **Transform** | Turn those bytes into our types. Knows about the upstream's column names and quirks. | `lib/pipeline/transforms/` |
| **Validate** | Reject rows that would poison an aggregate. Zod schemas. | `lib/pipeline/validate.ts` |
| **Load** | Upsert into PostgreSQL, write an `import_runs` row. | `lib/pipeline/load.ts` |
| **Recalculate** | Derive year-over-year change and refresh materialised aggregates. | `recalculate_yoy_change()` in SQL |

None of these directories exist yet. Creating them is the work — the interfaces
they should satisfy are below.

**Why the separation matters:** CMHC publishes a very different CSV from the
Ville de Montréal's GeoJSON, but they both end up as rows in the same two tables.
If fetching and mapping are tangled together, adding a fifth source means
understanding the other four. Kept apart, a new source is one connector, one
transform, and a row in `data_sources`.

---

## 2. Where the connectors go

```
lib/pipeline/
├── connectors/
│   ├── types.ts          # the DataConnector interface
│   ├── cmhc.ts           # CMHC Rental Market Survey
│   ├── montreal-open.ts  # Ville de Montréal open data
│   └── quebec-open.ts    # Données Québec
├── transforms/
│   ├── cmhc-rental.ts    # CMHC rows  → RentalMarketStat[]
│   └── boundaries.ts     # GeoJSON    → NeighbourhoodBoundary[]
├── validate.ts
├── load.ts
└── run.ts                # orchestration: the thing a scheduler calls
```

A connector satisfies one interface:

```ts
export interface DataConnector<TRaw> {
  /** Must match an `id` in the data_sources table. */
  readonly sourceId: string;
  /** Fetch whatever the upstream publishes, unmodified. */
  fetch(options: { since?: string; signal?: AbortSignal }): Promise<TRaw[]>;
}
```

It returns raw upstream rows. It does not touch the database, does not map field
names, and does not decide what is valid. That keeps it testable against a saved
fixture and keeps upstream weirdness contained.

A transform is a pure function:

```ts
export function transformCmhcRental(
  rows: CmhcRow[],
  neighbourhoods: Neighbourhood[],
): RentalMarketStat[];
```

Pure means testable without a network or a database, which matters because this
is the layer where mistakes are silent — a units error or a mis-joined
neighbourhood produces plausible numbers that are wrong.

### Things that reliably go wrong here

- **CMHC zones are not our neighbourhoods.** CMHC reports by survey zone; the
  transform needs an explicit zone → neighbourhood mapping table, and it should
  fail loudly on an unmapped zone rather than silently dropping it.
- **Suppressed values.** CMHC suppresses figures with too few observations,
  publishing `**` or an empty cell. That is not zero. It must become `null`, and
  a `null` must not reach a chart as a data point.
- **Accented names.** `Côte-des-Neiges` in one feed, `Cote-des-Neiges` in
  another. Join on slugs you control, never on display names.
- **French decimal separators.** `1 234,56` is a number in a Québec CSV. Parse
  it deliberately.

---

## 3. Validation

Every transformed row passes a Zod schema before it can be written:

```ts
// lib/pipeline/validate.ts
export const rentalStatSchema = z.object({
  neighbourhoodId: z.string().min(1),
  period: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
  bedroomType: z.enum(["studio", "oneBedroom", "twoBedroom", "threeBedroom"]),
  averageRent: z.number().positive().max(20_000),
  vacancyRate: z.number().min(0).max(100).nullable(),
  dataSourceId: z.string().min(1),
});
```

The upper bounds are deliberate. A decimal-point error turning `$1,800` into
`$180,000` passes every type check and quietly destroys the city average; a range
check catches it at the boundary. Rejected rows go into
`import_runs.error_message` with enough context to find them, and the run is
marked `partial` rather than `success` — a partial import that reports success is
worse than one that fails.

---

## 4. Loading

Two rules.

**Idempotent.** Re-running the same month must not duplicate anything. The
`UNIQUE (neighbourhood_id, period, bedroom_type)` constraint plus `ON CONFLICT`
gives you that for free:

```sql
INSERT INTO rental_market_stats
  (neighbourhood_id, period, bedroom_type, average_rent, median_rent,
   vacancy_rate, data_source_id, import_run_id)
VALUES ($1, to_date($2, 'YYYY-MM'), $3, $4, $5, $6, $7, $8)
ON CONFLICT (neighbourhood_id, period, bedroom_type) DO UPDATE
   SET average_rent   = EXCLUDED.average_rent,
       median_rent    = EXCLUDED.median_rent,
       vacancy_rate   = EXCLUDED.vacancy_rate,
       data_source_id = EXCLUDED.data_source_id,
       import_run_id  = EXCLUDED.import_run_id,
       updated_at     = now();
```

**Audited.** Open an `import_runs` row before fetching, close it after loading,
and only then advance `data_sources.last_updated`. A failed run must not move
that timestamp — otherwise the UI reports data as fresher than it is, which is
exactly the failure the source badge exists to prevent.

```ts
const runId = await beginImportRun(sourceId, "schedule");
try {
  const raw = await connector.fetch({ since: lastPeriod });
  const rows = transform(raw, neighbourhoods);
  const { valid, rejected } = validate(rows);
  await upsertRentalStats(valid, runId);
  await query("SELECT recalculate_yoy_change()");
  await completeImportRun(runId, {
    status: rejected.length ? "partial" : "success",
    recordsImported: valid.length,
    errorMessage: rejected.length ? summarise(rejected) : null,
  });
} catch (error) {
  await completeImportRun(runId, { status: "failed", errorMessage: String(error) });
  throw error;
}
```

---

## 5. Connecting the database to the app

The application talks to a `MarketDataRepository` (`lib/data/repository.ts`) and
nothing else. `PostgresMarketDataRepository` already implements that interface
against the schema in `docs/sql/001_initial_schema.sql`; what is missing is a
driver and one factory change.

**Step one — a `SqlExecutor`.** The repository needs one function:

```ts
// lib/data/pg.ts
import { Pool } from "pg";
import type { SqlExecutor } from "@/lib/data";

// One pool per process. Next.js reuses module state between requests, so
// creating a pool per request would exhaust connections quickly.
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 10,
  ssl: process.env.PGSSL === "require" ? { rejectUnauthorized: false } : undefined,
});

export const executeSql: SqlExecutor = async (sql, params = []) => {
  const result = await pool.query(sql, params);
  return result.rows;
};
```

**Step two — the factory.** In `lib/data/index.ts`:

```ts
export function getRepository(): MarketDataRepository {
  if (!repository) {
    repository = process.env.DATABASE_URL
      ? new PostgresMarketDataRepository(executeSql)
      : new DemoMarketDataRepository();
  }
  return repository;
}
```

That is the whole integration. Every page, route and component keeps working,
and `meta.dataQuality` flips from `demo` to `live` on its own — which means every
"Demo data · Not live market data" badge in the interface stops appearing,
because it reads that flag rather than a hard-coded value.

**On Supabase:** either use the connection string with `pg` exactly as above, or
write a `SqlExecutor` around `supabase.rpc()`. The former keeps the SQL in this
repository, which is usually what you want.

---

## 6. Scheduled imports

Three options, in increasing order of moving parts.

### Vercel Cron (simplest if you deploy there)

Add a route and a schedule:

```json
// vercel.json
{ "crons": [{ "path": "/api/internal/import/cmhc", "schedule": "0 6 1 * *" }] }
```

The route runs the pipeline for one source. Monthly at 06:00 UTC on the 1st,
because CMHC publishes monthly and nothing is gained by checking hourly.

### n8n (best for learning, and for combining sources)

n8n is a visual workflow tool, which makes it a good place to *see* a pipeline
before writing one. A workflow to import CMHC rental data:

```
┌──────────────┐   ┌──────────┐   ┌───────────┐   ┌──────────────┐   ┌─────────┐
│ Schedule     │──►│ HTTP     │──►│ Code      │──►│ HTTP Request │──►│ IF      │
│ 1st, monthly │   │ fetch    │   │ reshape   │   │ POST to our  │   │ failed? │
└──────────────┘   │ CMHC CSV │   │ to our    │   │ /api/internal│   └────┬────┘
                   └──────────┘   │ JSON      │   │ /import      │        │
                                  └───────────┘   └──────────────┘        ▼
                                                                    ┌──────────┐
                                                                    │ Notify   │
                                                                    └──────────┘
```

Node by node:

1. **Schedule Trigger** — cron `0 6 1 * *`.
2. **HTTP Request** — GET the upstream file. Response format `File` for a CSV,
   `JSON` for an API.
3. **Code** (or *Spreadsheet File* → *Edit Fields*) — reshape rows into the JSON
   our ingest endpoint expects. This is n8n standing in for the transform layer.
4. **HTTP Request** — POST to `POST /api/internal/import` with the API key in a
   header (see §7). Batch to a few hundred rows per request; a 4,000-row body
   will hit body-size limits.
5. **IF** — branch on the response status; on failure, send yourself a message.
   An import that fails silently is the same as no import.

The ingest endpoint does not exist yet. It should:

- authenticate the request (§7) before reading the body,
- validate every row with the Zod schemas from §3,
- upsert, write an `import_runs` row, and call `recalculate_yoy_change()`,
- return `{ imported, rejected, runId }` so the workflow can log something useful.

### GitHub Actions (free, and the code lives beside the app)

```yaml
name: Import market data
on:
  schedule: [{ cron: "0 6 1 * *" }]
  workflow_dispatch:            # keep this: you will want manual re-runs
jobs:
  import:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: npm }
      - run: npm ci
      - run: npx tsx lib/pipeline/run.ts --source=cmhc
        env:
          DATABASE_URL: ${{ secrets.DATABASE_URL }}
```

---

## 7. API authentication

The public read endpoints under `/api` serve aggregates and need no auth. Every
endpoint that writes, or that exposes operational metadata, does.

**This is built.** `lib/api/ingest-auth.ts` protects everything under
`/api/internal/`, and any future ingest endpoint uses the same guard rather than
its own:

```ts
// app/api/internal/<whatever>/route.ts
import { requireIngestAuth } from "@/lib/api/ingest-auth";

export async function POST(request: Request) {
  const denied = requireIngestAuth(request);
  if (denied) return denied;
  // …
}
```

The contract, in full, is in [`AUTOMATION.md`](./AUTOMATION.md) §2. In short:
`Authorization: Bearer $MARKET_INGEST_SECRET`, constant-time comparison over
SHA-256 digests, and fail-closed in production when no secret is configured.

**Use a header, not a query string.** URLs end up in server logs, browser
history and referrer headers; headers mostly do not.

Rules that matter more than the code:

- The secret lives in `.env.local` (git-ignored) and in your host's secret store.
  Never in the repository, never in a client component — anything imported by a
  `"use client"` file ships to the browser.
- Only `process.env` names prefixed `NEXT_PUBLIC_` are exposed to the browser.
  Never prefix a secret. `tests/auth.test.ts` asserts this mechanically.
- Rotate by accepting two secrets during a changeover, then dropping the old one.
- When you move past a shared secret, the next step is a signed request (HMAC of
  body + timestamp) which also gives you replay protection. A shared secret is
  fine to start; it is not fine forever.

---

## 8. What to build first

In order, because each step makes the next one easier:

1. **Apply the schema** to a local Postgres or a free Supabase project.
2. **Seed `neighbourhoods` and `data_sources`** from the demo profiles. This is a
   one-off script and it teaches you the insert path with data you already trust.
3. **Write `executeSql` and flip the factory.** The app now reads from Postgres
   with hand-inserted rows. Nothing in the UI changes — that is the proof the
   abstraction holds.
4. **Import one real source.** CMHC rental data is the best first target: public,
   documented, monthly, and it maps cleanly onto `rental_market_stats`.
5. **Schedule it**, and make failures visible.
6. **Then** add boundaries, and the map switches from schematic tiles to real
   outlines with no component changes.

Do not start at step 6. A map is more satisfying to build and much less useful
than a pipeline that reliably delivers correct numbers.
