import type { PipelineAlert } from "./alerts";

/**
 * Where alerts go.
 *
 * ## Deliberately vendor-neutral
 *
 * There is no Slack code in this file, and there should never be. Slack, Discord,
 * PagerDuty, email, n8n and everything after them are *transports*, and a
 * transport encoded into the monitoring layer is a transport you cannot change
 * without touching the logic that decides what is wrong. Worse, each one drags
 * in a payload format — Slack blocks, Discord embeds — and once the alert is
 * shaped like a Slack message, the alert *is* a Slack message.
 *
 * So this layer emits one neutral JSON shape and offers two transports:
 *
 *  - `ConsoleAlertProvider` — always on. Structured server log. On any host with
 *    log collection, this alone is a working alerting pipeline.
 *  - `WebhookAlertProvider` — optional, one URL. It POSTs the alert as JSON.
 *
 * Sending to a specific vendor is then that vendor's problem, solved outside
 * this codebase: point `PIPELINE_ALERT_WEBHOOK_URL` at an n8n webhook, a
 * serverless function, or Slack's own Workflow Builder, and do the formatting
 * there. Adding a third provider here means implementing one method.
 */

export interface AlertDelivery {
  provider: string;
  incidentKey: string;
  delivered: boolean;
  /** Why delivery failed, when it did. Never contains credentials. */
  error?: string;
}

export interface AlertProvider {
  readonly name: string;
  send(alert: PipelineAlert): Promise<AlertDelivery>;
}

/**
 * Writes alerts to the server log as one structured line each.
 *
 * `console.error` for critical, `console.warn` for warning, `console.info` for
 * recoveries — so a log-based alerting rule can key off the level without
 * parsing the message.
 */
export class ConsoleAlertProvider implements AlertProvider {
  readonly name = "console";

  constructor(private readonly logger: Pick<Console, "error" | "warn" | "info"> = console) {}

  async send(alert: PipelineAlert): Promise<AlertDelivery> {
    const line = `[pipeline-alert] ${alert.kind} ${alert.severity} ${alert.incidentKey} :: ${alert.title} :: ${alert.message}`;
    const payload = { alert };

    if (alert.kind === "recovered") this.logger.info(line, payload);
    else if (alert.severity === "critical") this.logger.error(line, payload);
    else this.logger.warn(line, payload);

    return { provider: this.name, incidentKey: alert.incidentKey, delivered: true };
  }
}

export interface WebhookAlertProviderOptions {
  /** Injected for tests; defaults to the global `fetch`. */
  fetchImpl?: typeof fetch;
  /** A monitoring call must not hang a scheduled run. Defaults to 5s. */
  timeoutMs?: number;
}

/**
 * POSTs the alert to one URL as `application/json`.
 *
 * The body is the alert object verbatim, wrapped so the schema can grow a
 * sibling field later without breaking a receiver that reads `alert.title`:
 *
 * ```json
 * { "source": "montreal-market-intelligence", "alert": { ... } }
 * ```
 *
 * Failures are returned, never thrown. An unreachable alerting endpoint must not
 * be able to fail the ingest run it was reporting on — that would turn a
 * monitoring outage into a data outage.
 */
export class WebhookAlertProvider implements AlertProvider {
  readonly name = "webhook";

  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(
    private readonly url: string,
    options: WebhookAlertProviderOptions = {},
  ) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 5000;
  }

  async send(alert: PipelineAlert): Promise<AlertDelivery> {
    try {
      const response = await this.fetchImpl(this.url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source: "montreal-market-intelligence", alert }),
        signal: AbortSignal.timeout(this.timeoutMs),
      });

      if (!response.ok) {
        return {
          provider: this.name,
          incidentKey: alert.incidentKey,
          delivered: false,
          // The status, not the body: a webhook error page can be enormous, and
          // the URL may carry a token that must not be echoed into a log.
          error: `Webhook responded ${response.status}.`,
        };
      }

      return { provider: this.name, incidentKey: alert.incidentKey, delivered: true };
    } catch (error) {
      return {
        provider: this.name,
        incidentKey: alert.incidentKey,
        delivered: false,
        error:
          error instanceof Error && error.name === "TimeoutError"
            ? `Webhook did not respond within ${this.timeoutMs}ms.`
            : "Webhook could not be reached.",
      };
    }
  }
}

/**
 * The providers configured for this process.
 *
 * Console is unconditional; the webhook is added only when a URL is set. The URL
 * itself is never logged or returned in an API response — it is frequently a
 * bearer token in disguise.
 */
export function getAlertProviders(
  environment: { webhookUrl?: string } = { webhookUrl: process.env.PIPELINE_ALERT_WEBHOOK_URL },
): AlertProvider[] {
  const providers: AlertProvider[] = [new ConsoleAlertProvider()];
  if (environment.webhookUrl) {
    providers.push(new WebhookAlertProvider(environment.webhookUrl));
  }
  return providers;
}

/**
 * Deliver alerts to every provider, collecting outcomes.
 *
 * Never throws, and never lets one provider's failure stop another's delivery:
 * if the webhook is down, the console record must still be written.
 */
export async function dispatchAlerts(
  alerts: PipelineAlert[],
  providers: AlertProvider[],
): Promise<AlertDelivery[]> {
  const deliveries: AlertDelivery[] = [];

  for (const alert of alerts) {
    for (const provider of providers) {
      try {
        deliveries.push(await provider.send(alert));
      } catch (error) {
        deliveries.push({
          provider: provider.name,
          incidentKey: alert.incidentKey,
          delivered: false,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  return deliveries;
}
