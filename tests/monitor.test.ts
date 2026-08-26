import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  resetAlertIncidentStore,
  resetBenchmarkRepository,
  resetImportRunStore,
  setAlertIncidentStore,
  setBenchmarkRepository,
  setImportRunStore,
} from "@/lib/data";
import { InMemoryImportRunStore } from "@/lib/data/import-run-store";
import { InMemoryAlertIncidentStore } from "@/lib/pipeline/alerts";
import { collectBenchmarkHealth, runPipelineMonitor } from "@/lib/pipeline/monitor";
import type { AlertProvider, AlertDelivery } from "@/lib/pipeline/alert-providers";
import type { PipelineAlert } from "@/lib/pipeline/alerts";
import { toIsoDate, previousBusinessDay } from "@/lib/calculations/business-days";
import {
  FakeLiveBenchmarkRepository,
  liveObservation,
} from "./fixtures/live-benchmark-repository";

/**
 * The orchestrator, wired to real stores rather than hand-built reports.
 *
 * This is what proves the four pieces actually connect: the repository's
 * freshness, the import store's run history, the health engine's state and the
 * alert evaluator's deduplication all have to line up for these to pass.
 */

class RecordingProvider implements AlertProvider {
  readonly name = "recording";
  readonly sent: PipelineAlert[] = [];

  async send(alert: PipelineAlert): Promise<AlertDelivery> {
    this.sent.push(alert);
    return { provider: this.name, incidentKey: alert.incidentKey, delivered: true };
  }
}

afterEach(() => {
  resetBenchmarkRepository();
  resetImportRunStore();
  resetAlertIncidentStore();
});

/** Yesterday, in business days — always inside the 2-day allowance. */
const recentBusinessDay = () => previousBusinessDay(toIsoDate(new Date()));

async function recordRun(
  runs: InMemoryImportRunStore,
  status: "success" | "failed" | "partial",
  overrides: { errorMessage?: string; errorKind?: string; rejected?: number } = {},
) {
  const id = await runs.startRun({ dataSourceId: "src-boc-valet", triggeredBy: "schedule" });
  await runs.completeRun(id, {
    status,
    recordsReceived: 10,
    recordsWritten: status === "failed" ? 0 : 10 - (overrides.rejected ?? 0),
    recordsRejected: overrides.rejected ?? 0,
    errorMessage: overrides.errorMessage ?? null,
    errorKind: overrides.errorKind ?? null,
  });
}

describe("collectBenchmarkHealth", () => {
  it("reports demo when no real store is connected", async () => {
    // The default factories: demo repository, empty run store.
    const reports = await collectBenchmarkHealth();
    assert.equal(reports.length, 1, "only the scheduled series is monitored");
    assert.equal(reports[0].state, "demo");
    assert.equal(reports[0].pipelineId, "src-boc-valet:5y-canada-bond");
  });

  it("reports healthy for a fresh live series with a successful run", async () => {
    setBenchmarkRepository(
      new FakeLiveBenchmarkRepository([liveObservation(recentBusinessDay())]),
    );
    const runs = new InMemoryImportRunStore();
    setImportRunStore(runs);
    await recordRun(runs, "success");

    const [report] = await collectBenchmarkHealth();
    assert.equal(report.state, "healthy");
    assert.equal(report.freshness, "live");
  });

  it("reports stale when the newest observation is too old", async () => {
    setBenchmarkRepository(new FakeLiveBenchmarkRepository([liveObservation("2026-01-05")]));
    const runs = new InMemoryImportRunStore();
    setImportRunStore(runs);
    await recordRun(runs, "success");

    const [report] = await collectBenchmarkHealth();
    assert.equal(report.state, "stale");
  });

  it("reports failing after two failed runs", async () => {
    setBenchmarkRepository(
      new FakeLiveBenchmarkRepository([liveObservation(recentBusinessDay())]),
    );
    const runs = new InMemoryImportRunStore();
    setImportRunStore(runs);
    await recordRun(runs, "success");
    await recordRun(runs, "failed", { errorMessage: "HTTP 503", errorKind: "http" });
    await recordRun(runs, "failed", { errorMessage: "HTTP 503", errorKind: "http" });

    const [report] = await collectBenchmarkHealth();
    assert.equal(report.state, "failing");
    assert.equal(report.consecutiveFailures, 2);
  });

  it("reports unavailable when nothing has ever been imported", async () => {
    setBenchmarkRepository(new FakeLiveBenchmarkRepository([]));
    setImportRunStore(new InMemoryImportRunStore());

    const [report] = await collectBenchmarkHealth();
    assert.equal(report.state, "unavailable");
  });

  it("ignores a still-running row when reading the last run", async () => {
    setBenchmarkRepository(
      new FakeLiveBenchmarkRepository([liveObservation(recentBusinessDay())]),
    );
    const runs = new InMemoryImportRunStore();
    setImportRunStore(runs);
    await recordRun(runs, "partial", { rejected: 3, errorMessage: "3 rejected" });
    await runs.startRun({ dataSourceId: "src-boc-valet", triggeredBy: "schedule" });

    const [report] = await collectBenchmarkHealth();
    assert.ok(
      report.signals.some((signal) => signal.code === "validation-rejections"),
      "the completed partial run is still the one described",
    );
  });
});

describe("runPipelineMonitor", () => {
  it("delivers an alert through every configured provider", async () => {
    setBenchmarkRepository(
      new FakeLiveBenchmarkRepository([liveObservation(recentBusinessDay())]),
    );
    const runs = new InMemoryImportRunStore();
    setImportRunStore(runs);
    setAlertIncidentStore(new InMemoryAlertIncidentStore());
    await recordRun(runs, "failed", { errorMessage: "HTTP 503", errorKind: "http" });
    await recordRun(runs, "failed", { errorMessage: "HTTP 503", errorKind: "http" });

    const provider = new RecordingProvider();
    const result = await runPipelineMonitor({ providers: [provider] });

    assert.equal(result.overall, "failing");
    assert.equal(result.alerts.length, 1);
    assert.equal(provider.sent.length, 1);
    assert.equal(result.deliveries[0].delivered, true);
    assert.equal(result.alerting.notified, true);
  });

  it("does not re-notify on a second run with the same problem", async () => {
    setBenchmarkRepository(
      new FakeLiveBenchmarkRepository([liveObservation(recentBusinessDay())]),
    );
    const runs = new InMemoryImportRunStore();
    setImportRunStore(runs);
    setAlertIncidentStore(new InMemoryAlertIncidentStore());
    await recordRun(runs, "failed", { errorMessage: "HTTP 503", errorKind: "http" });
    await recordRun(runs, "failed", { errorMessage: "HTTP 503", errorKind: "http" });

    const provider = new RecordingProvider();
    await runPipelineMonitor({ providers: [provider] });
    const second = await runPipelineMonitor({ providers: [provider] });

    assert.equal(provider.sent.length, 1, "the incident is not re-sent");
    assert.equal(second.suppressed.length, 1);
    assert.equal(second.openIncidents.length, 1);
  });

  it("notify:false assesses health and sends nothing", async () => {
    setBenchmarkRepository(
      new FakeLiveBenchmarkRepository([liveObservation(recentBusinessDay())]),
    );
    const runs = new InMemoryImportRunStore();
    setImportRunStore(runs);
    setAlertIncidentStore(new InMemoryAlertIncidentStore());
    await recordRun(runs, "failed", { errorMessage: "HTTP 503", errorKind: "http" });
    await recordRun(runs, "failed", { errorMessage: "HTTP 503", errorKind: "http" });

    const provider = new RecordingProvider();
    const result = await runPipelineMonitor({ providers: [provider], notify: false });

    assert.equal(result.overall, "failing", "the dashboard still learns the state");
    assert.deepEqual(result.alerts, []);
    assert.equal(provider.sent.length, 0);
    assert.equal(result.alerting.notified, false);
  });

  it("declares that in-memory incidents cannot deduplicate across processes", async () => {
    setAlertIncidentStore(new InMemoryAlertIncidentStore());
    const result = await runPipelineMonitor({ providers: [], notify: false });
    assert.match(result.alerting.deduplicationWarning ?? "", /process memory/);
  });

  it("sends a recovery once the pipeline succeeds again", async () => {
    setBenchmarkRepository(
      new FakeLiveBenchmarkRepository([liveObservation(recentBusinessDay())]),
    );
    const runs = new InMemoryImportRunStore();
    setImportRunStore(runs);
    setAlertIncidentStore(new InMemoryAlertIncidentStore());
    await recordRun(runs, "failed", { errorMessage: "HTTP 503", errorKind: "http" });
    await recordRun(runs, "failed", { errorMessage: "HTTP 503", errorKind: "http" });

    const provider = new RecordingProvider();
    await runPipelineMonitor({ providers: [provider] });

    await recordRun(runs, "success");
    await runPipelineMonitor({ providers: [provider] });

    assert.equal(provider.sent.length, 2);
    assert.equal(provider.sent[1].kind, "recovered");
    assert.equal(provider.sent[1].severity, "info");
  });
});
