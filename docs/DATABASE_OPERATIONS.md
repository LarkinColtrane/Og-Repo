# Running the database

Practical operations for the PostgreSQL behind this platform. Small-project
scale — no enterprise runbook, just the things that will actually matter.

---

## 1. What the database holds

| Table | Holds | Rows, roughly |
|---|---|---|
| `market_benchmarks` | Bond yield observations, one per business day per series | ~250/year/series |
| `civic_permit_stats` | Permit activity, one per borough per month | ~240/year |
| `import_runs` | Every import attempt, success or failure | one per run, forever |
| `alert_incidents` | Currently-open monitoring incidents | usually zero |
| `data_sources` | The source registry | 15 |
| `civic_geography` | Montréal boroughs and linked cities | 20 |
| `lenders` | The seven lenders | 7 |
| `mortgage_rates` | Lender rate history | empty — no importer yet |
| `neighbourhoods`, `sale_market_stats`, `rental_market_stats` | Market statistics | empty — no importer yet |
| `schema_migrations` | Which migrations have been applied | one per migration |

This is a **small** database. Five years of daily bond yields is about 1,250
rows. Do not over-plan for its size; plan for its *reconstructability*.

---

## 2. What can be rebuilt, and what cannot

This is the question that decides how much backup effort is worth it.

### Fully reconstructable — no backup needed

**`market_benchmarks`.** Every observation comes from the Bank of Canada Valet
API, which serves the full history on request. Losing this table costs one
backfill:

```bash
curl -X POST https://your-host/api/internal/market-data/bank-of-canada \
  -H "Authorization: Bearer $MARKET_INGEST_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"series": "5y-canada-bond", "startDate": "2021-01-01", "endDate": "2026-12-31"}'
```

**`civic_permit_stats`.** Same reasoning — the Ville de Montréal publishes the
permit dataset, and a re-import rebuilds the aggregates. One caveat: the city
publishes a *current* extract, so if they ever stop publishing older records,
history that was imported but not re-published would be gone. In practice this
is a low risk and a re-import is the answer.

**Reference tables** — `data_sources`, `civic_geography`, `lenders`. All seeded
by migrations. `npm run db:migrate` on an empty database recreates them.

### NOT reconstructable — worth preserving

**`import_runs`.** The operational history: what ran, when, whether it worked,
how many rows it wrote, what the error was. **Nothing can recreate this.** It is
the record of what your automation actually did, and it is what answers "when
did this last work?" six months from now. It is also tiny — one row per run.

**`alert_incidents`.** Only matters while an incident is open. Losing it causes
one duplicate alert per open incident, which is annoying rather than serious.

### Not yet applicable

**Any user data.** There are no user accounts. When that changes, this section
changes with it — user data is the category that genuinely needs a tested
restore, not just a backup.

---

## 3. Backups

### If you are on Supabase

Automatic daily backups are included on the free tier, retained for 7 days. For
this project that is genuinely sufficient: the only irreplaceable table is
`import_runs`, and a week of retention against a table that grows by a handful
of rows a day is proportionate.

Find them under **Database → Backups** in the Supabase dashboard.

### A manual snapshot before anything risky

Before a migration you are unsure about, or any manual `UPDATE`:

```bash
pg_dump "$DATABASE_URL" --no-owner --no-acl -f backup-$(date +%F).sql
```

Restore:

```bash
psql "$DATABASE_URL" -f backup-2026-08-26.sql
```

Just the irreplaceable part:

```bash
pg_dump "$DATABASE_URL" --data-only -t import_runs -f import-runs-$(date +%F).sql
```

> **A backup you have never restored is a hypothesis, not a backup.** Restore
> one into a scratch database once, so you know the command works before you
> need it at a bad moment.

---

## 4. Migrations

```bash
npm run db:status     # what is applied, what is pending
npm run db:migrate    # apply anything outstanding
```

Both read `DATABASE_URL`.

### The rules

1. **Migrations are append-only.** Once a file has been applied anywhere, it is
   history. Editing it is detected by checksum and the runner refuses to
   continue — because the file no longer describes the database, and every other
   environment will silently diverge. Add a new file instead.

2. **Additive changes are safe to run on a live system.** Every migration here
   only adds: new tables, new columns, new defaults. None drops or rewrites.
   Keep it that way, and a deploy never needs a maintenance window.

3. **Destructive changes need a plan.** Dropping a column, changing a type or
   renaming a table means: take a backup, verify the restore, deploy code that
   works with *both* shapes, then migrate, then remove the old path. If that
   sounds like a lot, it is — which is a good reason to prefer adding.

4. **Each migration runs in a transaction.** A failure leaves nothing behind and
   is not recorded as applied. Fix the file and run it again.

### Adding one

Create `docs/sql/00N_short_description.sql`, numbered after the last. The runner
applies files in filename order, so the number is the dependency order.

---

## 5. Connecting

```bash
export DATABASE_URL='postgresql://postgres:PASSWORD@HOST:5432/postgres'
psql "$DATABASE_URL"
```

Useful once you are in:

```sql
\dt                                    -- tables
\d market_benchmarks                   -- one table's shape
SELECT count(*) FROM market_benchmarks;
SELECT * FROM import_runs ORDER BY started_at DESC LIMIT 10;
SELECT * FROM alert_incidents;         -- usually empty; rows mean something is wrong
```

Where the data came from, and when:

```sql
SELECT data_source_id,
       count(*)              AS rows,
       min(observation_date) AS earliest,
       max(observation_date) AS latest,
       max(retrieved_at)     AS last_import
  FROM market_benchmarks
 GROUP BY data_source_id;
```

---

## 6. Connection limits

The pool is capped at **5 connections per application instance**
(`PGPOOL_MAX`), which looks small and is deliberate.

On a serverless platform every concurrent request can be a separate instance,
each with its own pool. Supabase's free tier allows 60 direct connections; ten
instances with a pool of 20 would exhaust that with almost no traffic, and the
symptom — `remaining connection slots are reserved` — looks nothing like its
cause.

If you hit connection limits on Supabase, use the **connection pooler** URI
(port `6543`) rather than the direct one (`5432`). It is designed for exactly
this shape of client.

---

## 7. Routine checks

**Weekly, or when something looks wrong**, open `/data-sources`. It reports
every pipeline's health, the last successful import, and which store backs each
dataset. That page is meant to answer this question so you do not have to open
a SQL client.

If you do want SQL:

```sql
-- Has anything failed lately?
SELECT data_source_id, status, error_kind, error_message, started_at
  FROM import_runs
 WHERE status = 'failed'
 ORDER BY started_at DESC
 LIMIT 20;

-- Is anything currently alerting?
SELECT incident_key, severity, opened_at, occurrences FROM alert_incidents;

-- Is the data actually moving?
SELECT series_code, max(observation_date) FROM market_benchmarks GROUP BY 1;
```

---

## 8. When something goes wrong

| Symptom | Likely cause | What to do |
|---|---|---|
| `password authentication failed` | Wrong password in `DATABASE_URL` | Reset it in your provider's dashboard and update the env var |
| `no pg_hba.conf entry ... SSL off` | Hosted database requires TLS | Set `PGSSL=require` |
| `self signed certificate` | Provider's CA is not in Node's store | `PGSSL=require` (encrypts without verifying) |
| `remaining connection slots are reserved` | Too many instances × pool size | Lower `PGPOOL_MAX`, or use the pooler URI |
| `relation "..." does not exist` | Migrations not applied | `npm run db:migrate` |
| `violates foreign key constraint "import_runs_data_source_id_fkey"` | The source registry is not seeded | `npm run db:migrate` — migration 006 seeds it |
| Build fails, `No sale statistics on record` | `MARKET_DATA_SOURCE=postgres` with an empty table | Unset it; there is no market importer yet |
| Site shows demo data unexpectedly | `DATABASE_URL` not set in that environment | Check the deployment's environment variables |

---

## 9. Two databases, not one

Keep the integration tests off your real database:

```bash
DATABASE_URL=postgresql://.../appdb        # the application
TEST_DATABASE_URL=postgresql://.../mtl_test  # the tests
```

The integration suite **truncates tables** between tests. It refuses to run
against a connection string that does not look like a test database — a name
containing `test`, or a host on localhost — because a test helper that can empty
production is a loaded gun on the table. Do not defeat that check.
