import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_REPEAT_AFTER_SECONDS,
  InMemoryAlertIncidentStore,
  evaluatePipelineAlerts,
  repeatAfterSecondsFromEnv,
} from "@/lib/pipeline/alerts";
import {
  ConsoleAlertProvider,
  WebhookAlertProvider,
  dispatchAlerts,
  getAlertProviders,
  type AlertProvider,
} from "@/lib/pipeline/alert-providers";
import { assessPipelineHealth, type PipelineHealthInput } from "@/lib/pipeline/health";
import type { ImportHealth } from "@/lib/data/import-run-store";

const importHealth = (overrides: Partial<ImportHealth> = {}): ImportHealth => ({
  dataSourceId: "src-boc-valet",
  lastSuccessAt: "2026-08-25T21:00:00.000Z",
  lastFailureAt: null,
  lastFailureMessage: null,
  lastFailureKind: null,
  lastSuccessRecordsWritten: 10,
  consecutiveFailures: 0,
  totalRuns: 12,
  ...overrides,
});

function report(overrides: Partial<PipelineHealthInput> = {}) {
  return assessPipelineHealth({
    pipelineId: "src-boc-valet:5y-canada-bond",
    dataSourceId: "src-boc-valet",
    label: "5Y GoC bond yield",
    dataQuality: "live",
    freshness: "live",
    businessDayLag: 1,
    maxBusinessDayLag: 2,
    latestObservationDate: "2026-08-25",
    importHealth: importHealth(),
    lastRun: null,
    ...overrides,
  });
}

const failing = () =>
  report({
    importHealth: importHealth({
      consecutiveFailures: 2,
      lastFailureAt: "2026-08-26T09:00:00.000Z",
      lastFailureMessage: "The Bank of Canada returned HTTP 503.",
      lastFailureKind: "http",
    }),
  });

const stale = () =>
  report({ freshness: "stale", businessDayLag: 9, latestObservationDate: "2026-08-13" });

const clock = (iso: string) => () => new Date(iso);

describe("alert triggering", () => {
  it("raises on two consecutive failures", async () => {
    const store = new InMemoryAlertIncidentStore();
    const { alerts } = await evaluatePipelineAlerts([failing()], {
      store,
      now: clock("2026-08-26T10:00:00Z"),
    });

    assert.equal(alerts.length, 1);
    assert.equal(alerts[0].kind, "raised");
    assert.equal(alerts[0].signalCode, "consecutive-failures");
    assert.equal(alerts[0].severity, "critical");
    assert.equal(alerts[0].incidentKey, "src-boc-valet:5y-canada-bond:consecutive-failures");
    assert.match(alerts[0].title, /5Y GoC bond yield/);
  });

  it("raises on stale data even when every import succeeded", async () => {
    const store = new InMemoryAlertIncidentStore();
    const { alerts } = await evaluatePipelineAlerts([stale()], {
      store,
      now: clock("2026-08-26T10:00:00Z"),
    });

    assert.equal(alerts.length, 1);
    assert.equal(alerts[0].signalCode, "stale-data");
  });

  it("raises on validation rejections", async () => {
    const store = new InMemoryAlertIncidentStore();
    const { alerts } = await evaluatePipelineAlerts(
      [
        report({
          lastRun: {
            id: "run-9",
            status: "partial",
            startedAt: "2026-08-26T09:00:00.000Z",
            completedAt: "2026-08-26T09:00:03.000Z",
            recordsWritten: 8,
            recordsRejected: 2,
            errorKind: "partial-validation",
            errorMessage: "2 observation(s) failed validation.",
          },
        }),
      ],
      { store, now: clock("2026-08-26T10:00:00Z") },
    );

    assert.equal(alerts.length, 1);
    assert.equal(alerts[0].signalCode, "validation-rejections");
    assert.equal(alerts[0].severity, "warning");
  });

  it("raises on a unit anomaly", async () => {
    const store = new InMemoryAlertIncidentStore();
    const { alerts } = await evaluatePipelineAlerts(
      [
        report({
          importHealth: importHealth({
            consecutiveFailures: 1,
            lastFailureKind: "unit-anomaly",
            lastFailureMessage: "Median 0.032 is outside the plausible band.",
          }),
        }),
      ],
      { store, now: clock("2026-08-26T10:00:00Z") },
    );

    assert.ok(alerts.some((alert) => alert.signalCode === "unit-anomaly"));
  });

  it("raises on a persistence failure", async () => {
    const store = new InMemoryAlertIncidentStore();
    const { alerts } = await evaluatePipelineAlerts(
      [
        report({
          importHealth: importHealth({
            consecutiveFailures: 1,
            lastFailureKind: "persistence",
            lastFailureMessage: "This repository is read-only.",
          }),
        }),
      ],
      { store, now: clock("2026-08-26T10:00:00Z") },
    );

    assert.ok(alerts.some((alert) => alert.signalCode === "persistence-failure"));
  });

  it("sends nothing for a healthy pipeline", async () => {
    const store = new InMemoryAlertIncidentStore();
    const { alerts } = await evaluatePipelineAlerts([report()], {
      store,
      now: clock("2026-08-26T10:00:00Z"),
    });
    assert.deepEqual(alerts, []);
  });

  it("sends nothing for demo data on its own", async () => {
    const store = new InMemoryAlertIncidentStore();
    const { alerts } = await evaluatePipelineAlerts(
      [report({ dataQuality: "demo", freshness: "demo" })],
      { store, now: clock("2026-08-26T10:00:00Z") },
    );
    assert.deepEqual(alerts, [], "a demo build must not page anyone for being a demo");
  });

  it("still alerts when a scheduler is failing against a demo store", async () => {
    // Deliberate: the state is `demo`, but somebody has pointed a scheduler at
    // this deployment and every run is failing. That is a real misconfiguration
    // — the demo repository refuses writes — and staying silent about it would
    // be the monitor hiding the one thing it exists to report.
    const store = new InMemoryAlertIncidentStore();
    const { alerts } = await evaluatePipelineAlerts(
      [
        report({
          dataQuality: "demo",
          freshness: "demo",
          importHealth: importHealth({
            consecutiveFailures: 2,
            lastFailureKind: "persistence",
            lastFailureMessage: "This repository is read-only.",
          }),
        }),
      ],
      { store, now: clock("2026-08-26T10:00:00Z") },
    );

    assert.ok(alerts.some((alert) => alert.signalCode === "persistence-failure"));
    assert.equal(alerts[0].state, "demo", "the state still describes what is being served");
  });
});

describe("deduplication", () => {
  it("does not re-notify the same unresolved incident on the next run", async () => {
    const store = new InMemoryAlertIncidentStore();
    const first = await evaluatePipelineAlerts([failing()], {
      store,
      now: clock("2026-08-26T10:00:00Z"),
    });
    const second = await evaluatePipelineAlerts([failing()], {
      store,
      now: clock("2026-08-26T10:15:00Z"),
    });

    assert.equal(first.alerts.length, 1);
    assert.equal(second.alerts.length, 0, "the second observation is suppressed");
    assert.equal(second.suppressed.length, 1);
    assert.equal(second.suppressed[0].nextEligibleAt, "2026-08-26T16:00:00.000Z");
  });

  it("stays quiet across many runs inside the repeat window", async () => {
    const store = new InMemoryAlertIncidentStore();
    let sent = 0;
    for (let minute = 0; minute < 24 * 4; minute += 1) {
      const at = new Date(Date.parse("2026-08-26T10:00:00Z") + minute * 15 * 60_000);
      const { alerts } = await evaluatePipelineAlerts([failing()], {
        store,
        now: () => at,
        repeatAfterSeconds: DEFAULT_REPEAT_AFTER_SECONDS,
      });
      sent += alerts.length;
    }
    // 96 evaluations over 24 hours. Four notifications — the initial one at
    // 00:00 plus reminders at 06:00, 12:00 and 18:00 — instead of 96 identical
    // messages. That ratio is the entire point of the incident store.
    assert.equal(sent, 4, `expected 4 notifications over 24h, got ${sent}`);
  });

  it("re-notifies once the repeat interval has elapsed", async () => {
    const store = new InMemoryAlertIncidentStore();
    await evaluatePipelineAlerts([failing()], { store, now: clock("2026-08-26T10:00:00Z") });
    const later = await evaluatePipelineAlerts([failing()], {
      store,
      now: clock("2026-08-26T16:00:00Z"),
    });

    assert.equal(later.alerts.length, 1);
    assert.equal(later.alerts[0].kind, "reminder");
    assert.equal(later.alerts[0].occurrences, 2);
    assert.equal(later.alerts[0].openedAt, "2026-08-26T10:00:00.000Z", "the incident is the same one");
  });

  it("escalates a warning to critical without sending a recovery first", async () => {
    // The regression this guards: when one failure and repeated failures were
    // two signal codes, the second failure closed the first incident — sending
    // "Recovered: an import failure" in the same batch as "Pipeline failing".
    const store = new InMemoryAlertIncidentStore();
    const oneFailure = report({
      importHealth: importHealth({
        consecutiveFailures: 1,
        lastFailureMessage: "HTTP 503",
        lastFailureKind: "http",
      }),
    });

    const first = await evaluatePipelineAlerts([oneFailure], {
      store,
      now: clock("2026-08-26T10:00:00Z"),
    });
    assert.equal(first.alerts.length, 1);
    assert.equal(first.alerts[0].severity, "warning");

    // Five minutes later — well inside the repeat window — it fails again.
    const second = await evaluatePipelineAlerts([failing()], {
      store,
      now: clock("2026-08-26T10:05:00Z"),
    });

    assert.equal(second.alerts.length, 1, "one alert, not an escalation plus a recovery");
    assert.equal(second.alerts[0].severity, "critical");
    assert.equal(second.alerts[0].kind, "raised", "escalation bypasses the repeat window");
    assert.ok(
      !second.alerts.some((alert) => alert.kind === "recovered"),
      "getting worse must never read as recovery",
    );
    assert.equal(
      second.alerts[0].openedAt,
      "2026-08-26T10:00:00.000Z",
      "it is still the same incident",
    );
  });

  it("keeps two different problems on one pipeline as two incidents", async () => {
    const store = new InMemoryAlertIncidentStore();
    const both = report({
      freshness: "stale",
      businessDayLag: 9,
      importHealth: importHealth({
        consecutiveFailures: 3,
        lastFailureMessage: "HTTP 503",
        lastFailureKind: "http",
      }),
    });
    const { alerts, open } = await evaluatePipelineAlerts([both], {
      store,
      now: clock("2026-08-26T10:00:00Z"),
    });

    assert.equal(alerts.length, 2);
    assert.equal(open.length, 2);
    assert.deepEqual(
      alerts.map((alert) => alert.signalCode).sort(),
      ["consecutive-failures", "stale-data"],
    );
  });

  it("keeps the same problem on two series as two incidents", async () => {
    const store = new InMemoryAlertIncidentStore();
    const five = stale();
    const policy = { ...stale(), pipelineId: "src-boc-valet:boc-policy-rate", label: "Policy rate" };

    const { alerts } = await evaluatePipelineAlerts([five, policy], {
      store,
      now: clock("2026-08-26T10:00:00Z"),
    });
    assert.equal(alerts.length, 2, "one source, two series, two incidents");
  });
});

describe("recovery", () => {
  it("sends a recovery notification when the problem stops", async () => {
    const store = new InMemoryAlertIncidentStore();
    await evaluatePipelineAlerts([failing()], { store, now: clock("2026-08-26T10:00:00Z") });

    const recovered = await evaluatePipelineAlerts([report()], {
      store,
      now: clock("2026-08-26T11:00:00Z"),
    });

    assert.equal(recovered.alerts.length, 1);
    assert.equal(recovered.alerts[0].kind, "recovered");
    assert.equal(recovered.alerts[0].severity, "info");
    assert.equal(recovered.alerts[0].detail.resolvedAfterSeconds, 3600);
    assert.deepEqual(recovered.open, [], "the incident is closed");
  });

  it("does not send a second recovery for an already-closed incident", async () => {
    const store = new InMemoryAlertIncidentStore();
    await evaluatePipelineAlerts([failing()], { store, now: clock("2026-08-26T10:00:00Z") });
    await evaluatePipelineAlerts([report()], { store, now: clock("2026-08-26T11:00:00Z") });
    const third = await evaluatePipelineAlerts([report()], {
      store,
      now: clock("2026-08-26T12:00:00Z"),
    });
    assert.deepEqual(third.alerts, []);
  });

  it("does not close an incident on a pipeline this run did not assess", async () => {
    const store = new InMemoryAlertIncidentStore();
    const policy = { ...failing(), pipelineId: "src-boc-valet:boc-policy-rate", label: "Policy rate" };
    await evaluatePipelineAlerts([failing(), policy], {
      store,
      now: clock("2026-08-26T10:00:00Z"),
    });

    // A run limited to the 5-year series must not declare the policy rate fixed.
    const partial = await evaluatePipelineAlerts([report()], {
      store,
      now: clock("2026-08-26T11:00:00Z"),
    });

    assert.equal(partial.alerts.length, 1);
    assert.equal(partial.alerts[0].pipelineId, "src-boc-valet:5y-canada-bond");
    assert.equal(partial.open.length, 1);
    assert.equal(partial.open[0].pipelineId, "src-boc-valet:boc-policy-rate");
  });

  it("re-raises as a new incident if the problem comes back", async () => {
    const store = new InMemoryAlertIncidentStore();
    await evaluatePipelineAlerts([failing()], { store, now: clock("2026-08-26T10:00:00Z") });
    await evaluatePipelineAlerts([report()], { store, now: clock("2026-08-26T11:00:00Z") });
    const again = await evaluatePipelineAlerts([failing()], {
      store,
      now: clock("2026-08-26T11:30:00Z"),
    });

    assert.equal(again.alerts.length, 1);
    assert.equal(again.alerts[0].kind, "raised");
    assert.equal(again.alerts[0].openedAt, "2026-08-26T11:30:00.000Z");
  });
});

describe("repeat interval configuration", () => {
  it("defaults to six hours", () => {
    assert.equal(repeatAfterSecondsFromEnv(undefined), DEFAULT_REPEAT_AFTER_SECONDS);
  });

  it("reads a configured value", () => {
    assert.equal(repeatAfterSecondsFromEnv("900"), 900);
  });

  it("falls back on nonsense rather than alerting continuously", () => {
    assert.equal(repeatAfterSecondsFromEnv("not-a-number"), DEFAULT_REPEAT_AFTER_SECONDS);
    assert.equal(repeatAfterSecondsFromEnv("-1"), DEFAULT_REPEAT_AFTER_SECONDS);
  });
});

describe("alert providers", () => {
  const alert = async () => {
    const store = new InMemoryAlertIncidentStore();
    const { alerts } = await evaluatePipelineAlerts([failing()], {
      store,
      now: clock("2026-08-26T10:00:00Z"),
    });
    return alerts[0];
  };

  it("ConsoleAlertProvider logs criticals at error level", async () => {
    const lines: string[] = [];
    const logger = {
      error: (line: string) => lines.push(`error ${line}`),
      warn: (line: string) => lines.push(`warn ${line}`),
      info: (line: string) => lines.push(`info ${line}`),
    };
    const delivery = await new ConsoleAlertProvider(logger).send(await alert());

    assert.equal(delivery.delivered, true);
    assert.equal(lines.length, 1);
    assert.match(lines[0], /^error /);
    assert.match(lines[0], /consecutive-failures/);
  });

  it("WebhookAlertProvider POSTs neutral JSON", async () => {
    interface Captured {
      url: string;
      body: { source: string; alert: { signalCode: string } };
      headers: unknown;
    }
    const captures: Captured[] = [];
    const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
      captures.push({
        url: String(url),
        body: JSON.parse(String(init?.body)),
        headers: init?.headers,
      });
      return new Response(null, { status: 204 });
    }) as unknown as typeof fetch;

    const provider = new WebhookAlertProvider("https://hooks.example.test/pipeline", {
      fetchImpl,
    });
    const delivery = await provider.send(await alert());

    assert.equal(delivery.delivered, true);
    assert.equal(captures.length, 1);
    const [captured] = captures;
    assert.equal(captured.url, "https://hooks.example.test/pipeline");
    assert.equal(captured.body.source, "montreal-market-intelligence");
    assert.equal(captured.body.alert.signalCode, "consecutive-failures");
    // Nothing vendor-shaped: no Slack blocks, no Discord embeds, no attachments.
    for (const key of ["blocks", "embeds", "attachments", "text"]) {
      assert.ok(!(key in captured.body), `payload leaked a vendor field: ${key}`);
    }
  });

  it("WebhookAlertProvider reports a non-2xx without throwing", async () => {
    const fetchImpl = (async () => new Response("nope", { status: 500 })) as unknown as typeof fetch;
    const delivery = await new WebhookAlertProvider("https://x.test", { fetchImpl }).send(
      await alert(),
    );
    assert.equal(delivery.delivered, false);
    assert.match(delivery.error ?? "", /500/);
    assert.ok(!(delivery.error ?? "").includes("nope"), "the response body is not echoed");
  });

  it("WebhookAlertProvider reports an unreachable endpoint without throwing", async () => {
    const fetchImpl = (async () => {
      throw new TypeError("fetch failed");
    }) as unknown as typeof fetch;
    const delivery = await new WebhookAlertProvider("https://x.test", { fetchImpl }).send(
      await alert(),
    );
    assert.equal(delivery.delivered, false);
    assert.match(delivery.error ?? "", /could not be reached/);
  });

  it("dispatchAlerts keeps delivering after one provider fails", async () => {
    const exploding: AlertProvider = {
      name: "exploding",
      send: async () => {
        throw new Error("boom");
      },
    };
    const lines: string[] = [];
    const console_ = new ConsoleAlertProvider({
      error: (line: string) => lines.push(line),
      warn: () => {},
      info: () => {},
    });

    const deliveries = await dispatchAlerts([await alert()], [exploding, console_]);

    assert.equal(deliveries.length, 2);
    assert.equal(deliveries[0].delivered, false);
    assert.equal(deliveries[1].delivered, true, "the console record is still written");
    assert.equal(lines.length, 1);
  });

  it("getAlertProviders adds the webhook only when a URL is configured", () => {
    assert.deepEqual(
      getAlertProviders({ webhookUrl: undefined }).map((p) => p.name),
      ["console"],
    );
    assert.deepEqual(
      getAlertProviders({ webhookUrl: "https://hooks.example.test" }).map((p) => p.name),
      ["console", "webhook"],
    );
  });
});
