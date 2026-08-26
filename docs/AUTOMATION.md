# Running the pipeline unattended

Everything needed to have this platform import data on a schedule, notice when
that stops working, and tell somebody — without a person watching.

Four layers, each usable on its own:

```
  scheduler  ─→  /api/internal/market-data/scheduled  ─→  ingest  ─→  health  ─→  alerts
  (yours)        (this app, provider-neutral)             (existing)   (engine)   (providers)
```

---

## 1. The one endpoint a scheduler needs

```
POST /api/internal/market-data/scheduled
GET  /api/internal/market-data/scheduled
```

One request runs every scheduled import and then evaluates monitoring. That is
the whole of "operating unattended".

```bash
curl -X POST https://your-host/api/internal/market-data/scheduled \
  -H "Authorization: Bearer $MARKET_INGEST_SECRET"
```

### Why both verbs

Vercel Cron can only issue `GET`. n8n and `curl`-from-cron default to `POST`.
Supporting one and not the other would tie this application to a scheduler
through the back door. `GET` reads its options from the query string, `POST`
from a JSON body, and **both are optional** — a bare URL does the right thing.

### Options

| Option | Default | Meaning |
|---|---|---|
| `series` | all scheduled series | Limit the run to one series |
| `recent` | `10` | Size of the overlapping window, in observations |
| `notify` | `true` | Set `false` to assess health without sending anything |

```bash
# POST with a body
curl -X POST https://your-host/api/internal/market-data/scheduled \
  -H "Authorization: Bearer $MARKET_INGEST_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"recent": 30}'

# GET with a query string
curl "https://your-host/api/internal/market-data/scheduled?recent=30" \
  -H "Authorization: Bearer $MARKET_INGEST_SECRET"
```

### Why the window is 10 and not 1

A scheduled import re-fetches days it has already seen. That overlap is what
makes the pipeline self-healing:

- A run that was missed on Tuesday is repaired by Wednesday's run.
- A value the publisher later revises gets corrected rather than frozen.

Writes upsert on `(series_code, observation_date)`, so re-importing the same ten
days writes the same ten rows. **Running this endpoint twice in a row is safe
and produces no duplicates.** That property is what lets you retry freely.

### Why a failed import still returns `200`

The status code answers *"did the scheduler reach the application?"*. The body
answers *"did the data arrive?"*:

```jsonc
{
  "data": {
    "ok": false,                       // ← this is the field to watch
    "series": [{ "seriesCode": "5y-canada-bond", "status": "failed", "runId": "…" }],
    "monitor": { "overall": "failing", "alerts": [ … ] }
  }
}
```

Returning `5xx` would make most schedulers retry immediately — hammering an
upstream that is already failing, and turning one incident into a dozen. The
failure is not swallowed: the run is recorded in the audit trail, the monitor
raises an incident, and the reason is in the body. `401` and `400` *are* real
HTTP failures, because those mean the scheduler itself is misconfigured.

### What comes back

```jsonc
{
  "data": {
    "ok": true,
    "triggeredBy": "schedule",
    "window": { "recent": 10 },
    "series": [{
      "seriesCode": "5y-canada-bond",
      "ok": true, "status": "success", "runId": "run-mem-12",
      "recordsReceived": 10, "recordsWritten": 10,
      "recordsRejected": 0, "recordsSkipped": 0,
      "firstObservationDate": "2026-08-12", "lastObservationDate": "2026-08-25",
      "errorKind": null, "errorMessage": null, "durationMs": 431
    }],
    "monitor": {
      "overall": "healthy",
      "reports": [ /* one PipelineHealthReport per series */ ],
      "alerts": [], "suppressed": [], "openIncidents": [],
      "deliveries": [],
      "alerting": {
        "notified": true, "providers": ["console"],
        "repeatAfterSeconds": 21600,
        "incidentStore": "In-memory (incidents reset when the process restarts)",
        "deduplicationWarning": "…"
      }
    }
  },
  "meta": { "dataQuality": "demo", "generatedAt": "…", "sources": [ … ] }
}
```

---

## 2. Authentication

Every endpoint under `/api/internal/` requires a shared secret:

```
Authorization: Bearer $MARKET_INGEST_SECRET
```

Generate one:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

| Condition | Response |
|---|---|
| Correct secret | The handler runs |
| No `Authorization` header | `401` · `outcome: missing-credentials` |
| Not the `Bearer` scheme | `401` · `outcome: malformed-credentials` |
| Wrong secret | `401` · `outcome: invalid-credentials` |
| No secret set, `NODE_ENV=production` | `401` · `outcome: not-configured` |
| No secret set, development | Runs, with a `warning` in the response |

`outcome` is there so an operator wiring up a scheduler can tell *"I sent no
header"* from *"I sent the wrong secret"* from *"the server has no secret"* —
three problems with three different fixes, none of which reveals the expected
value.

### Fail closed in production

With no secret configured and `NODE_ENV=production`, the endpoints return `401`
and refuse to run. An endpoint that writes data and calls a third party must not
be open because somebody forgot an environment variable. Being unavailable is
far cheaper than the alternative.

Outside production the same endpoints run unprotected so you can develop without
ceremony — and every response says so, in a `warning` field, so an unprotected
deployment announces itself instead of looking identical to a protected one.

### Three things the implementation guarantees

1. **The secret never reaches the browser.** No `NEXT_PUBLIC_` prefix (which is
   the only thing Next.js inlines into client bundles), and it is read only from
   server files. `tests/auth.test.ts` walks the source tree and asserts both.
2. **The secret is never logged.** Not in a message, not in error `details`, not
   on success. Rejections describe the request shape and nothing else.
3. **Comparison is constant-time.** `===` returns sooner the earlier the first
   differing byte is, which over enough requests leaks a secret one character at
   a time. Both sides are SHA-256'd so `timingSafeEqual` gets equal-length
   buffers — which also avoids leaking the real secret's length.

Rotation: accept two secrets during the changeover, then drop the old one.

---

## 3. When to run it

```
0 21 * * 1-5      # 21:00 UTC ≈ 17:00 Eastern, weekdays
```

The Bank of Canada publishes once per business day, generally in the afternoon
Eastern time. Once per business day after publication is right. A series that
updates daily gains nothing from hourly polling, and a free public API deserves
the courtesy.

Weekdays only. The weekend runs would find nothing new, and an empty response is
noise the monitor then has to be taught to ignore.

---

## 4. Four schedulers, same endpoint

Nothing below is special-cased in the application. There is no n8n signature
check, no `x-vercel-cron` header, no GitHub Actions assumption — just a URL, a
secret and JSON. Changing scheduler is not a code change.

### n8n

```
Schedule Trigger  →  HTTP Request  →  IF  →  (your notification node)
(0 21 * * 1-5)       (POST)            ok?
```

1. **Schedule Trigger** — Cron, `0 21 * * 1-5`.
2. **HTTP Request**
   - Method `POST`
   - URL `https://your-host/api/internal/market-data/scheduled`
   - Header `Authorization: Bearer {{$env.MARKET_INGEST_SECRET}}`
   - Response format JSON
3. **IF** — condition `{{ $json.data.ok }}` is false → your notification node.

You can skip step 3 entirely by pointing `PIPELINE_ALERT_WEBHOOK_URL` at an n8n
Webhook node instead (§7). Then n8n handles *formatting and delivery* and this
application handles *deciding what is worth sending* — which is the right split,
because the deduplication logic belongs next to the health data.

### Vercel Cron

`vercel.json`:

```json
{
  "crons": [
    {
      "path": "/api/internal/market-data/scheduled",
      "schedule": "0 21 * * 1-5"
    }
  ]
}
```

⚠️ **Vercel Cron cannot send a custom header.** It issues a plain `GET`. Two
supported ways to authenticate it:

- Set `MARKET_INGEST_SECRET` to the same value as Vercel's own `CRON_SECRET`.
  Vercel sends `Authorization: Bearer $CRON_SECRET` on cron invocations, which
  is exactly the header this endpoint expects — no adapter needed.
- Or put a small proxy in front (a Vercel Function, an Edge Middleware matcher)
  that adds the header.

Do **not** solve this by accepting the secret in a query string. URLs land in
access logs, browser history and referrer headers.

⚠️ Each Vercel invocation is a **fresh process**, so the in-memory incident
store cannot deduplicate between runs (§6). Back it with a database, or accept
one notification per failed run.

### GitHub Actions

`.github/workflows/ingest.yml`:

```yaml
name: Scheduled market data import

on:
  schedule:
    - cron: "0 21 * * 1-5"
  workflow_dispatch:        # so you can also run it by hand

jobs:
  ingest:
    runs-on: ubuntu-latest
    steps:
      - name: Trigger ingest
        env:
          INGEST_URL: ${{ secrets.INGEST_URL }}
          MARKET_INGEST_SECRET: ${{ secrets.MARKET_INGEST_SECRET }}
        run: |
          set -euo pipefail
          response=$(curl -sS -X POST "$INGEST_URL/api/internal/market-data/scheduled" \
            -H "Authorization: Bearer $MARKET_INGEST_SECRET" \
            -H "Content-Type: application/json" \
            -w "\n%{http_code}")

          status=$(printf '%s' "$response" | tail -n1)
          body=$(printf '%s' "$response" | sed '$d')
          echo "$body" | jq .

          [ "$status" = "200" ] || { echo "HTTP $status"; exit 1; }
          # `ok` is the data question; the status code was only the reachability one.
          [ "$(echo "$body" | jq -r '.data.ok')" = "true" ] || exit 1
```

Store the secret in **Settings → Secrets and variables → Actions**. Never in the
workflow file — it is in the repository.

⚠️ GitHub's scheduled workflows are best-effort and can be delayed by minutes
under load, and are disabled automatically on repositories with no activity for
60 days. Fine for a daily import; not a real-time trigger.

### Plain cron

```cron
0 21 * * 1-5 /usr/local/bin/import-market-data >> /var/log/market-import.log 2>&1
```

`/usr/local/bin/import-market-data`:

```bash
#!/usr/bin/env bash
set -euo pipefail

# Not inline in the crontab: crontabs are world-readable on many systems.
# chmod 600 this file, and the environment file it reads.
source /etc/market-intelligence.env   # defines INGEST_URL, MARKET_INGEST_SECRET

curl -sS --fail-with-body --max-time 120 \
  -X POST "$INGEST_URL/api/internal/market-data/scheduled" \
  -H "Authorization: Bearer $MARKET_INGEST_SECRET" \
  -H "Content-Type: application/json"
```

`cron` mails output to the account owner if a mail transport exists, so a
non-zero exit is not silent. Confirm that on your host, or rely on §7 instead —
an unmonitored cron job is indistinguishable from no cron job.

---

## 5. Health

`lib/pipeline/health.ts`. A pure function over plain data, deliberately **not**
inside a React component: the same rule is needed by the operations dashboard,
the alerting job and the diagnostics endpoint, and three copies of it would
drift until the dashboard showed green while an alert was firing.

### The six states

| State | Means | Typical cause |
|---|---|---|
| `healthy` | Recent success, data within its publication lag | Nothing to do |
| `degraded` | Working, but something is off | One failed run, or rows being rejected |
| `failing` | Repeated failures; nothing new is arriving | Upstream down, credentials, format change |
| `stale` | Imports may be fine, but the data has stopped moving | Publisher paused, or a silently empty window |
| `demo` | Serving the generated fallback | No `DATABASE_URL` |
| `unavailable` | Nothing on record and no successful import ever | Never run, or never worked |

### Two questions, kept separate

A pipeline has two failure modes that fail independently:

- **Is the data current?** — freshness of the newest observation.
- **Is anything still trying?** — outcome of recent runs.

A publisher can pause while every run succeeds (fresh pipeline, stale data).
Every run since Tuesday can have failed while the data still looks recent
(broken pipeline, not yet old enough to notice). Reporting only one hides half
the failures, so a health report carries both.

### Precedence

`demo` → `unavailable` → `failing` → `stale` → `degraded` → `healthy`.

`demo` wins because a generated series has no freshness to be wrong about;
calling it "failing" would describe a pipeline that was never running.
`failing` beats `stale` because when imports are broken, staleness is the
symptom and the broken import is what to go and fix. The staleness is still
reported in the signals — it just is not the headline.

### Signals

A state is derived from *signals*, not the other way round, so a dashboard can
explain **why** something is amber:

| Code | Severity | Raised when |
|---|---|---|
| `consecutive-failures` | warning → critical | ≥1 failure since last success; critical at ≥2 |
| `stale-data` | critical | Newest observation beyond the series' business-day allowance |
| `validation-rejections` | warning | The last run wrote some rows and refused others |
| `unit-anomaly` | critical | A batch was refused as mis-scaled — the feed may have changed units |
| `persistence-failure` | critical | The store refused a write |
| `empty-range` | warning | Upstream returned nothing where something was expected |
| `never-imported` | warning | No data and no successful import, ever |
| `demo-fallback` | info | Serving generated data |

Import failure is **one** code at two severities, not two codes. When it was
two, the second failure closed the "one failure" incident — sending "Recovered:
an import failure" in the same batch as "Pipeline failing: repeated import
failures". As one incident it escalates, and the channel reads correctly.

---

## 6. Alerts

`lib/pipeline/alerts.ts`.

### What triggers one

Any signal of severity `warning` or `critical`. `info` never alerts — paging
somebody because a demo build is serving demo data is how alert fatigue starts.

In the terms of the brief: `consecutiveFailures >= 2` and `freshness = stale`
both alert, as do validation, unit and persistence anomalies.

### Not alerting 288 times over a weekend

Alerting is stateful. An **incident** opens the first time a problem is seen and
stays open while it persists. A notification goes out when it opens, and then at
most once per `PIPELINE_ALERT_REPEAT_SECONDS` (default 6h) while it stays open.

> A pipeline scheduled every 15 minutes, broken for 24 hours:
> **4 notifications**, not 96. (`tests/alerts.test.ts` asserts exactly this.)

An incident is keyed on `pipelineId` + signal code:

- Two different problems on one series are two incidents, so a stale-data alert
  is not suppressed by an unrelated validation alert that fired first.
- The same problem on two series is two incidents, because one source can feed
  several series and they fail independently.

**Escalation bypasses the window.** An incident that goes from `warning` to
`critical` re-notifies immediately: being told at 09:00 that rows were being
rejected must not suppress the 09:15 message saying the pipeline has stopped.

### Recovery notifications

When a problem stops being reported, the incident closes and a recovery
notification goes out. "It is fixed" is exactly as useful as "it is broken", and
a channel carrying only bad news teaches people that silence means nothing
rather than that silence means healthy.

A run limited to one series **never closes another series' incident** — that
would send a recovery for a problem still happening.

### Durability

The incident store is in-memory by default. On a host that runs each scheduled
execution in a fresh process (Vercel, Lambda, a container per cron run),
deduplication cannot work and every evaluation re-notifies.

This is reported rather than hidden: `data.monitor.alerting.deduplicationWarning`
carries the explanation on every response. Back `AlertIncidentStore` with a
database table before relying on deduplication in that environment —
`getAlertIncidentStore()` in `lib/data/index.ts` is the only place to change.

---

## 7. Where alerts go

`lib/pipeline/alert-providers.ts`.

```ts
export interface AlertProvider {
  readonly name: string;
  send(alert: PipelineAlert): Promise<AlertDelivery>;
}
```

### Vendor-neutral on purpose

There is no Slack code in this codebase and there should never be. Slack,
Discord, PagerDuty, email and n8n are *transports*. A transport encoded into the
monitoring layer is a transport you cannot change without touching the logic
that decides what is wrong — and worse, it drags in a payload format. Once the
alert is shaped like a Slack message, the alert *is* a Slack message.

### The two built in

**`ConsoleAlertProvider`** — always on, no configuration. One structured line
per alert, at a level matching severity:

```
[pipeline-alert] raised critical src-boc-valet:5y-canada-bond:consecutive-failures :: …
```

`console.error` for critical, `console.warn` for warning, `console.info` for
recoveries — so a log-based alert rule can key off the level without parsing the
message. On any host with log collection, this alone is a working alerting
pipeline.

**`WebhookAlertProvider`** — enabled by setting one variable:

```bash
PIPELINE_ALERT_WEBHOOK_URL=https://your-n8n-host/webhook/pipeline-alert
```

It `POST`s `application/json`:

```jsonc
{
  "source": "montreal-market-intelligence",
  "alert": {
    "incidentKey": "src-boc-valet:5y-canada-bond:consecutive-failures",
    "kind": "raised",                    // raised · reminder · recovered
    "pipelineId": "src-boc-valet:5y-canada-bond",
    "dataSourceId": "src-boc-valet",
    "label": "5Y GoC bond yield",
    "signalCode": "consecutive-failures",
    "severity": "critical",              // info · warning · critical
    "state": "failing",
    "title": "Pipeline failing: 5Y GoC bond yield — import failures",
    "message": "2 consecutive import failures since the last success. Latest: …",
    "openedAt": "2026-08-26T10:00:00.000Z",
    "raisedAt": "2026-08-26T10:15:00.000Z",
    "occurrences": 2,
    "detail": { "consecutiveFailures": 2, "errorKind": "http", "…": "…" }
  }
}
```

No blocks, no embeds, no attachments. Point it at an n8n Webhook node, a
serverless function, or Slack's own Workflow Builder, and do the vendor
formatting **there**.

### Failures are returned, never thrown

An unreachable alerting endpoint must not fail the ingest run it was reporting
on — that turns a monitoring outage into a data outage. Delivery outcomes come
back in `data.monitor.deliveries`, and one provider failing never stops another:
if the webhook is down, the console record is still written.

The webhook URL is never logged or echoed in a response. It is frequently a
bearer token in disguise.

### Adding a third provider

Implement `send`, add it to `getAlertProviders()`. Nothing else changes.

---

## 8. Environment variables

| Variable | Required | Default | Purpose |
|---|---|---|---|
| `MARKET_INGEST_SECRET` | In production | — | Shared secret for `/api/internal/*` |
| `PIPELINE_ALERT_WEBHOOK_URL` | No | — | Enables `WebhookAlertProvider` |
| `PIPELINE_ALERT_REPEAT_SECONDS` | No | `21600` | Re-notify interval for an open incident |
| `DATABASE_URL` | For real ingestion | — | Without it the store is read-only and refuses writes |

All are documented in `.env.example`. None may carry a `NEXT_PUBLIC_` prefix.

---

## 9. Verifying it before you trust it

```bash
npm test                      # unit + integration, no network needed

npm run build
MARKET_INGEST_SECRET=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))") \
  npm start
```

Then, with that secret in `$SECRET`:

```bash
# 401 — no credentials
curl -i -X POST localhost:3000/api/internal/market-data/scheduled

# 401 — wrong secret
curl -i -X POST localhost:3000/api/internal/market-data/scheduled \
  -H "Authorization: Bearer wrong"

# 200 — runs, and reports honestly whether the data arrived
curl -s -X POST localhost:3000/api/internal/market-data/scheduled \
  -H "Authorization: Bearer $SECRET" | jq '.data.ok, .data.monitor.overall'

# Operational detail
curl -s localhost:3000/api/internal/market-data/status \
  -H "Authorization: Bearer $SECRET" | jq
```

To watch deduplication work, call the scheduler three times against a failing
upstream. You should see: `raised`/`warning`, then `raised`/`critical`
(escalation), then nothing but a `suppressed` entry.

### Two limitations, stated rather than discovered

1. **No `DATABASE_URL` in this environment**, so the benchmark store is the
   read-only demo repository and ingestion fails at the persistence step — on
   purpose, rather than accepting rows into memory that vanish on restart.
2. **Outbound access to `www.bankofcanada.ca` is blocked here** by egress
   policy. Every import therefore fails with `errorKind: "http"` and a message
   naming the proxy as the likely cause. That was not worked around; it is
   reported, and it made the failure path genuinely testable end to end.
