/**
 * Québec transfer duty ("droit de mutation", commonly the *taxe de bienvenue*).
 *
 * The bracket engine below is real: duty is charged progressively on the greater
 * of the sale price and the municipal assessment, and Montréal adds brackets above
 * the provincial schedule.
 *
 * ⚠️ The bracket thresholds themselves are carried here as a **demo assumption**.
 * They are indexed every year and are published by the city; this file is not a
 * live source for them, so the UI labels any figure derived from it the same way
 * it labels demo market data. Replace `MONTREAL_TRANSFER_DUTY_BRACKETS` with values
 * fetched from the city before treating the output as anything but an illustration.
 *
 * @see https://montreal.ca/en/topics/welcome-tax-transfer-duties
 */

export interface TransferDutyBracket {
  /** Upper bound of the bracket in dollars; `null` means no upper bound. */
  upTo: number | null;
  /** Marginal rate applied within the bracket, as a fraction. */
  rate: number;
}

export const MONTREAL_TRANSFER_DUTY_BRACKETS: TransferDutyBracket[] = [
  { upTo: 58_900, rate: 0.005 },
  { upTo: 294_600, rate: 0.01 },
  { upTo: 552_300, rate: 0.015 },
  { upTo: 1_104_700, rate: 0.02 },
  { upTo: 2_136_500, rate: 0.025 },
  { upTo: 3_113_000, rate: 0.035 },
  { upTo: null, rate: 0.04 },
];

export const TRANSFER_DUTY_SOURCE = {
  label: "Demo assumption — verify current brackets",
  url: "https://montreal.ca/en/topics/welcome-tax-transfer-duties",
  isDemo: true,
} as const;

export interface TransferDutyBreakdown {
  total: number;
  bands: Array<{ from: number; to: number; rate: number; amount: number }>;
}

/**
 * Progressive duty on a taxable base. Each bracket's rate applies only to the
 * portion of the price that falls inside it.
 */
export function calculateTransferDuty(
  taxableBase: number,
  brackets: TransferDutyBracket[] = MONTREAL_TRANSFER_DUTY_BRACKETS,
): TransferDutyBreakdown {
  const base = Math.max(0, taxableBase);
  const bands: TransferDutyBreakdown["bands"] = [];
  let previousCap = 0;
  let total = 0;

  for (const bracket of brackets) {
    if (base <= previousCap) break;
    const cap = bracket.upTo ?? base;
    const portion = Math.min(base, cap) - previousCap;
    if (portion > 0) {
      const amount = portion * bracket.rate;
      total += amount;
      bands.push({
        from: previousCap,
        to: Math.min(base, cap),
        rate: bracket.rate,
        amount: Math.round(amount * 100) / 100,
      });
    }
    previousCap = cap;
  }

  return { total: Math.round(total), bands };
}

/**
 * A rough all-in closing cost estimate: transfer duty plus notary, inspection and
 * adjustments. The non-duty portion is a flat allowance, not a quote.
 */
export const OTHER_CLOSING_COST_ALLOWANCE = 3_500;

export function estimateClosingCosts(purchasePrice: number): {
  transferDuty: number;
  otherCosts: number;
  total: number;
} {
  const transferDuty = calculateTransferDuty(purchasePrice).total;
  return {
    transferDuty,
    otherCosts: OTHER_CLOSING_COST_ALLOWANCE,
    total: transferDuty + OTHER_CLOSING_COST_ALLOWANCE,
  };
}
