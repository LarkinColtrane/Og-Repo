# Bank of Canada market benchmarks

The first real external data source in this platform: the Government of Canada
5-year benchmark bond yield, ingested from the Bank of Canada's public Valet API.

---

## 1. The distinction that matters most

> ### A bond yield is not a mortgage rate
>
> The Government of Canada 5-year yield is what the **federal government pays to
> borrow** for five years. A 5-year fixed mortgage rate is what **a lender charges
> you**. They are different numbers, paid by different parties, for different risk.
>
> They are related: lenders fund 5-year fixed mortgages against that part of the
> yield curve, so when the bond yield moves, fixed mortgage pricing usually
> follows within days or weeks. But **the relationship is not one-to-one**. The
> gap between them — the spread — widens and narrows with credit conditions,
> competition, and each lender's own funding mix. It has ranged from well under a
> point to well over two.
>
> **No borrower is ever offered the bond yield.** It must never be displayed as a
> lender rate, defaulted into a mortgage calculator, or used as a stand-in when a
> lender rate is unavailable.

The interface states this on the page, the database says it in a table comment,
and the two data streams meet only in the analysis layer — never in storage.

---

## 2. The source

| | |
|---|---|
| **API** | Bank of Canada Valet API |
| **Docs** | https://www.bankofcanada.ca/valet/docs |
| **Endpoint** | `GET https://www.bankofcanada.ca/valet/observations/{series}/json` |
| **Series** | `BD.CDN.5YR.DQ.YLD` |
| **Represents** | Yield on the Government of Canada bond currently used as the 5-year benchmark, percent per annum |
| **Cadence** | One observation per business day, published in the afternoon Eastern time |
| **History** | Available for decades — well past the 5–10 years this platform needs |
| **Authentication** | None. The API is public and keyless |
| **Licence** | Bank of Canada terms of use — open, attribution required |
| **Scraping** | Not used, not needed. This is the publisher's own machine-readable API |

Two request forms are supported:

```bash
# A date range
curl "https://www.bankofcanada.ca/valet/observations/BD.CDN.5YR.DQ.YLD/json?start_date=2021-01-01&end_date=2026-08-26"

# The N most recent observations
curl "https://www.bankofcanada.ca/valet/observations/BD.CDN.5YR.DQ.YLD/json?recent=30"
```

### Other series the registry already knows about

| Internal code | Valet series | Notes |
|---|---|---|
| `5y-canada-bond` | `BD.CDN.5YR.DQ.YLD` | Ingested and displayed |
| `10y-canada-bond` | `BD.CDN.10YR.DQ.YLD` | Registered, not yet surfaced |
| `boc-policy-rate` | `V39079` | Registered. The benchmark a **variable** mortgage should be read against |

Adding a series is one entry in
[`lib/pipeline/connectors/bank-of-canada/series.ts`](../lib/pipeline/connectors/bank-of-canada/series.ts).
The connector, normalizer, validator, ingest service and API are all
series-agnostic.

### Two identifiers, on purpose

`5y-canada-bond` is ours — it appears in URLs, in the database, and in the UI.
`BD.CDN.5YR.DQ.YLD` is theirs, and it is confined to the series registry and the
connector. If the Bank renames a series, one TypeScript entry changes and no data
migrates.

---

## 3. The pipeline

```
Bank of Canada Valet API
          ↓
BankOfCanadaConnector          lib/pipeline/connectors/bank-of-canada/client.ts
          ↓                    HTTP, timeout, typed errors. No business logic.
normalizeBankOfCanadaSeries()  lib/pipeline/transforms/bank-of-canada.ts
          ↓                    Their shape → our canonical model. Pure function.
Zod validation                 lib/pipeline/validate.ts
          ↓                    Rejects corruption without rejecting unusual markets.
ingestBankOfCanadaSeries()     lib/pipeline/ingest/bank-of-canada.ts
          ↓                    Orchestrates, and always records a run.
market_benchmarks              docs/sql/003_market_benchmarks.sql
import_runs                    upsert by (series_code, observation_date)
          ↓
MarketBenchmarkRepository      lib/data/benchmark-repository.ts
          ↓                    The seam. Demo and PostgreSQL implementations.
/api/market/benchmarks         app/api/market/benchmarks/route.ts
          ↓
Invest workspace               components/investor/benchmark-panel.tsx
```

Separately, and meeting it only at the last step:

```
Mortgage rate provider → MortgageRateRepository → /api/mortgage/* → lender comparison
```

The two streams share no table, no repository and no refresh schedule. They meet
in one place: the spread, computed on render in the UI.

### Stage by stage

**Connector.** Makes the request, applies a 15-second timeout, and classifies
every failure into `network`, `timeout`, `http` or `malformed`. It confirms the
body has an `observations` array and nothing more — it does not judge whether a
yield is plausible, because that is not an HTTP concern. `fetch` is injected, so
the whole thing is testable against a fixture with no network.

**Normalizer.** A pure function: response in, `BenchmarkObservation[]` out.
`retrievedAt` is passed in rather than read from the clock, so the same input
always produces the same output. It absorbs three Valet quirks:

1. Values arrive as **strings** — `{"v": "3.21"}`, not `{"v": 3.21}`.
2. Non-publication days arrive as **empty strings**, not as missing rows. These
   are dropped, never coerced — `Number("")` is `0`, and a 0% bond yield is a
   plausible-looking lie that would sit in the database forever.
3. The series is a **dynamic key** on each row, so a row is read by the series
   name that was requested.

**Validation.** Zod, plus one statistical check. Per row: a real calendar date,
a finite value, and a yield inside −5% to 30%. The bounds are wide on purpose —
Canada's early-1980s yields were above 16%, and a validator tuned to today's
market would have thrown away that history. Negative is allowed because negative
government yields have existed elsewhere and asserting otherwise is a claim about
markets that is not true.

Duplicate observation dates inside one batch are rejected: two values claiming the
same natural key would make the upsert arbitrary.

The statistical check, `detectUnitAnomaly`, catches what per-row bounds cannot. A
feed that switches from percent to fractions sends `0.0321`, which is inside the
hard bounds and indistinguishable from a genuine near-zero rate — for one row. For
a whole batch it is not: if every observation sits below 0.05%, that is a unit
error and the run fails rather than storing it.

**Ingest service.** Orchestrates the four stages and **always records a run**.
Every exit path goes through `completeRun`. A batch with some rejections is
recorded as `partial`, never `success` — a run that reports success while
discarding a tenth of its rows is how a slow feed regression goes unnoticed for
months.

**Persistence.** Upsert on `(series_code, observation_date)`. Re-running the same
range is safe and leaves the same rows.

---

## 4. Failure visibility

A pipeline that can fail quietly is worse than no pipeline, because it looks like
one that works. Three mechanisms:

**Every run is recorded.** `import_runs` gets a row before the first byte is
fetched and a completion on the way out. A crashed process leaves a `running` row
that never completed — visible as a problem rather than as nothing at all.

**Failures are classified.** `error_kind` is one of `network`, `timeout`, `http`,
`malformed`, `validation`, `unit-anomaly`, `persistence` or `empty-range`. That
distinction is what separates "the publisher is down" from "the publisher changed
their format", which need different responses.

**Diagnostics are exposed.**

```bash
curl localhost:3000/api/internal/market-data/status | jq
```

returns, per series: freshness, business-day lag, latest observation; and for the
source: last success, last failure with its message and kind, consecutive failure
count, and the last ten runs.

The Invest page surfaces the same facts to a reader: the data-quality badge, the
last successful import, and the last failure if there was one.

### Two kinds of freshness

They fail independently and mean different things:

- **Data freshness** — how old the latest observation is. *Is this number current?*
- **Pipeline health** — when an import last succeeded or failed. *Is anything still trying?*

A pipeline can be green while the data is stale (the publisher paused), and data
can look current while every import since has failed. Reporting only one hides
half the failures, so the snapshot carries both.

---

## 5. The staleness rule

> **An observation is `live` when it is at most 2 *business days* old, `stale`
> beyond that.**

Business days, not calendar days, and that is the entire point. The Bank
publishes once per business day, so:

| Latest observation | Read on | Business days | Verdict |
|---|---|---|---|
| Friday | Saturday | 0 | live |
| Friday | Sunday | 0 | live |
| Friday | Monday | 1 | live |
| Tuesday 30 Jun | Thursday 2 Jul (Canada Day between) | 1 | live |
| Three weeks ago | today | ~15 | **stale** |

A calendar-day rule would declare Friday's number stale every Sunday, and the
badge would cry wolf twice a week until nobody read it. Canadian market holidays
are excluded too, so Good Friday and Christmas do not age the data.

The 2-business-day allowance covers the publication lag — the Bank posts in the
afternoon, so the current day's figure is unavailable all morning — plus one
missed run, without letting a genuinely stalled pipeline look healthy for a week.

The allowance is per series. The policy rate gets 10 business days, because it
changes only on scheduled announcement dates and can legitimately sit unchanged
for weeks.

Holidays are computed, not listed: fixed dates, "nth Monday of" rules, and Good
Friday from the Gregorian Easter algorithm. See
[`lib/calculations/business-days.ts`](../lib/calculations/business-days.ts).

### The four states

| State | Meaning |
|---|---|
| `live` | Real data, within the publication lag |
| `stale` | Real data, older than the schedule can explain — the pipeline may have stopped |
| `demo` | The generated fallback. Never presented as a measurement |
| `unavailable` | Nothing on record for this series |

`demo` is separate from `live`/`stale` because "is this current?" does not apply
to a number nobody published. Six-year-old demo data is still `demo`, not `stale`.

---

## 6. Running an import

```bash
# Backfill five years
curl -X POST localhost:3000/api/internal/market-data/bank-of-canada \
  -H 'content-type: application/json' \
  -d '{"series":"5y-canada-bond","startDate":"2021-01-01","endDate":"2026-08-26"}'

# Daily top-up
curl -X POST localhost:3000/api/internal/market-data/bank-of-canada \
  -H 'content-type: application/json' \
  -d '{"series":"5y-canada-bond","recent":30}'
```

A successful response reports `recordsReceived`, `recordsWritten`,
`recordsRejected`, `recordsSkipped` and the date range written. A failure returns
a 500 whose `details` carry the run id, the error kind and the exact URL
requested — never a stack trace.

**Ingestion requires a database.** The demo fallback is read-only and refuses
writes: an ingest that appeared to succeed into memory that vanishes on restart
would record a success, look healthy in diagnostics, and have stored nothing.
Failing loudly points at the actual fix.

```bash
psql "$DATABASE_URL" -f docs/sql/003_market_benchmarks.sql
```

then set `DATABASE_URL` and wire the factory in
[`lib/data/index.ts`](../lib/data/index.ts):

```ts
export function getBenchmarkRepository(): MarketBenchmarkRepository {
  if (!benchmarkRepository) {
    benchmarkRepository = process.env.DATABASE_URL
      ? new PostgresMarketBenchmarkRepository(executeSql)
      : new DemoMarketBenchmarkRepository();
  }
  return benchmarkRepository;
}
```

The same `executeSql` serves all three repositories — these are tables in one
database, not separate systems.

---

## 7. Authentication

**Both internal endpoints require a shared secret**, sent as a bearer token:

```
Authorization: Bearer $MARKET_INGEST_SECRET
```

| Condition | Result |
|---|---|
| Correct secret | Handler runs |
| Header missing | `401`, `outcome: missing-credentials` |
| Not the `Bearer` scheme | `401`, `outcome: malformed-credentials` |
| Wrong secret | `401`, `outcome: invalid-credentials` |
| No secret configured, `NODE_ENV=production` | `401`, `outcome: not-configured` |
| No secret configured, development | Allowed, with a `warning` in the response |

The check lives in `lib/api/ingest-auth.ts` and runs **before the request body is
read**, so an unauthorised caller cannot make this host contact the Bank of
Canada. Three properties are enforced and tested:

1. **Never client-side.** No `NEXT_PUBLIC_` prefix, and `tests/auth.test.ts`
   walks the source tree asserting that no client component reads the variable.
2. **Never logged.** Not in a message, not in `details`, not on success.
3. **Constant-time comparison.** Both values are SHA-256'd before
   `timingSafeEqual`, which gives it two equal-length buffers and avoids leaking
   the real secret's length.

This is *not* an authentication system. There are no users, sessions or roles —
one secret, held by a scheduler, checked by a server. That is the right size for
machine-to-machine calls, and deliberately too small to grow into anything else.

The public read endpoint `/api/market/benchmarks` is intentionally open. It
serves published government data.

---

## 8. Scheduling

Implemented. `POST` or `GET /api/internal/market-data/scheduled` runs every
scheduled import and then evaluates monitoring, in one request.

```bash
curl -X POST https://your-host/api/internal/market-data/scheduled \
  -H "Authorization: Bearer $MARKET_INGEST_SECRET"
```

Once per business day after the afternoon publication is right — a series that
updates daily gains nothing from hourly polling, and the Bank's terms deserve
the courtesy:

```
0 21 * * 1-5   # 21:00 UTC ≈ 17:00 Eastern, weekdays
```

The window is `recent: 10`, not `1`. The overlap repairs any day a previous run
missed and picks up a revised value; the upsert on
`(series_code, observation_date)` makes re-importing the same ten days free.

**See [AUTOMATION.md](./AUTOMATION.md)** for the endpoint contract, worked
examples for n8n, Vercel Cron, GitHub Actions and plain cron, and how the health
and alerting layers behave.

---

## 9. Testing without the network

Every layer is tested offline:

- The connector takes an injected `fetch`, so success, network failure, timeout,
  HTTP error and malformed-body paths all run against fixtures.
- The normalizer and validator are pure functions.
- The repository is tested against a fake `SqlExecutor` that implements the
  upsert semantics without a database.
- The ingest service is tested end to end through those fakes, including that a
  failed run is recorded.

```bash
npm test
```

What this does **not** prove is that the SQL is syntactically valid or that the
Valet response shape still matches the fixture. Only a live database and a live
request prove those, and both are noted as limitations in the report.
