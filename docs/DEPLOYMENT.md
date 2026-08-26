# Deploying

The application runs anywhere Next.js runs. This describes Vercel plus a hosted
PostgreSQL, because that is the shortest path from here to a system that can
reach the Bank of Canada and the Ville de Montréal.

Nothing in the codebase depends on Vercel. The scheduler is a plain
authenticated HTTP endpoint — see [AUTOMATION.md](./AUTOMATION.md) for the same
setup with n8n, GitHub Actions or cron.

---

## 1. Why deployment is required at all

The development environment this was built in **cannot reach the official
sources**. Its egress policy answers `403` to `www.bankofcanada.ca`,
`donnees.montreal.ca` and every hosted-database host. That restriction was
reported rather than worked around, which is why the pipelines are complete and
tested but have never made a successful live request.

Deploying somewhere with ordinary outbound access is what closes that gap. It is
not a formality — it is the step that turns "the architecture is tested" into
"the system works".

---

## 2. Environment variables

| Variable | Required | Sensitive | What it does |
|---|---|---|---|
| `DATABASE_URL` | yes | **yes** | Connection string. Makes benchmarks, permits, import history and alerts live |
| `MARKET_INGEST_SECRET` | yes | **yes** | Shared secret for `/api/internal/*` |
| `PGSSL` | usually | no | `require` for most hosted databases |
| `PGPOOL_MAX` | no | no | Connections per instance. Default 5 |
| `PIPELINE_ALERT_WEBHOOK_URL` | no | **yes** | Sends alerts to a webhook as well as the log |
| `PIPELINE_ALERT_REPEAT_SECONDS` | no | no | Re-notify interval. Default 21600 (6h) |
| `MARKET_DATA_SOURCE` | no | no | `postgres` once a market importer exists. Leave unset |
| `MORTGAGE_RATES_SOURCE` | no | no | `postgres` once a rate feed exists. Leave unset |

Set these in the platform's own environment settings — **never in a file in the
repository**. `.env.local` is git-ignored and is for local development only.

`MARKET_INGEST_SECRET` must be set in production. With it missing, every
`/api/internal/` endpoint returns `401` and refuses to run: an endpoint that
writes data and calls a third party must not be open because somebody forgot a
variable.

---

## 3. Order of operations

Deploying before migrating produces a site that renders but cannot import.
Migrating before the database exists produces a confusing error. The order:

```
1. Create the database
2. Apply migrations           npm run db:migrate
3. Deploy with DATABASE_URL and MARKET_INGEST_SECRET set
4. Verify the deployment reports the right stores   /data-sources
5. First small live import — read the response before scheduling anything
6. Backfill
7. Enable the schedule
```

Steps 5 and 6 are deliberately manual. The first contact with a real API is
where a documented assumption meets reality, and the response is worth reading
before a cron job starts making the same request every day.

---

## 4. Scheduling

`vercel.json` in the repository root declares two cron entries:

```json
{
  "crons": [
    { "path": "/api/internal/market-data/scheduled?pipelines=benchmarks", "schedule": "0 21 * * 1-5" },
    { "path": "/api/internal/market-data/scheduled?pipelines=civic",      "schedule": "0 6 5 * *" }
  ]
}
```

Two entries, one endpoint, different cadences — the bond yield publishes every
business day, permits monthly. `21:00 UTC` is roughly 17:00 Eastern, after the
Bank of Canada's afternoon publication. Weekdays only: weekend runs would find
nothing new, and an empty response is noise the monitor then has to ignore.

### Authenticating the cron

⚠️ **Vercel Cron cannot send a custom header.** It issues a plain `GET` with
`Authorization: Bearer $CRON_SECRET`, using a value Vercel manages.

The endpoint expects exactly that header, so the simplest correct wiring is to
**set `MARKET_INGEST_SECRET` to the same value as `CRON_SECRET`**. No adapter,
no special-casing, and the endpoint stays provider-neutral.

Do not solve this by accepting the secret in a query string. URLs end up in
access logs, browser history and referrer headers.

### Cron on the free tier

Vercel's Hobby plan allows a limited number of cron jobs and runs them once a
day at an unspecified hour. For a daily bond yield that is acceptable. If you
need the schedule honoured precisely, run it from GitHub Actions instead — the
workflow is in [AUTOMATION.md](./AUTOMATION.md) and needs no plan change.

---

## 5. Verifying a deployment

```bash
# The site is up
curl -s https://your-host/api/data-sources | jq '.meta.dataQuality'

# The right stores are backing the right datasets
curl -s https://your-host/api/internal/market-data/status \
  -H "Authorization: Bearer $MARKET_INGEST_SECRET" | jq '.data.store'
# expect: benchmarks "PostgreSQL", importRuns "PostgreSQL import_runs", ephemeral false

# Authentication is on
curl -s -o /dev/null -w '%{http_code}\n' -X POST \
  https://your-host/api/internal/market-data/scheduled
# expect: 401
```

Then open `/data-sources` in a browser. It reports which store backs each
dataset and every pipeline's health — it is the page that answers "is this
actually working?".

---

## 6. First live import

Small, manual, and read the response:

```bash
curl -s -X POST https://your-host/api/internal/market-data/bank-of-canada \
  -H "Authorization: Bearer $MARKET_INGEST_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"series": "5y-canada-bond", "recent": 5}' | jq
```

`recent: 5` rather than a five-year backfill. If the real response differs from
the documented shape, this fails with five rows at stake instead of twelve
hundred, and the error names the difference.

Then confirm the rows exist, and only then backfill:

```bash
curl -s -X POST https://your-host/api/internal/market-data/bank-of-canada \
  -H "Authorization: Bearer $MARKET_INGEST_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"series": "5y-canada-bond", "startDate": "2021-01-01", "endDate": "2026-12-31"}' | jq
```

The Ville de Montréal import is the same shape, at
`/api/internal/market-data/montreal-permits`, with one difference: its column
names have never been checked against a live response. Expect the first attempt
to either work or return `schema-mismatch` listing the columns the resource
actually has — which is exactly the list needed to correct the field contract.
That is the designed behaviour, not a failure.

---

## 7. What must never be committed

- `DATABASE_URL`, or any connection string containing a password
- `MARKET_INGEST_SECRET`
- `PIPELINE_ALERT_WEBHOOK_URL` (frequently a bearer token in disguise)
- Supabase service-role keys
- Any `.env.local`

`tests/security.test.ts` checks the mechanical parts of this — no
`NEXT_PUBLIC_` prefix on a secret, no client component reading one, no `.env`
tracked in Git, no route echoing one into a response. Run it before deploying.
