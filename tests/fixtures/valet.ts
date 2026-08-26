import type { ValetObservationsResponse } from "@/lib/pipeline/connectors/bank-of-canada/types";

/**
 * A trimmed but structurally faithful Valet response for BD.CDN.5YR.DQ.YLD.
 *
 * Includes the two shapes that matter: normal business days, and an empty `v`
 * for a day the Bank published nothing (here 2026-04-03, Good Friday).
 */
export const valetFiveYearFixture: ValetObservationsResponse = {
  terms: { url: "https://www.bankofcanada.ca/terms/" },
  seriesDetail: {
    "BD.CDN.5YR.DQ.YLD": {
      label: "GOC benchmark bond yields - 5 year",
      description: "Government of Canada benchmark bond yields - 5 year",
    },
  },
  observations: [
    { d: "2026-04-01", "BD.CDN.5YR.DQ.YLD": { v: "3.18" } },
    { d: "2026-04-02", "BD.CDN.5YR.DQ.YLD": { v: "3.205" } },
    { d: "2026-04-03", "BD.CDN.5YR.DQ.YLD": { v: "" } }, // Good Friday
    { d: "2026-04-06", "BD.CDN.5YR.DQ.YLD": { v: "3.24" } },
    { d: "2026-04-07", "BD.CDN.5YR.DQ.YLD": { v: "3.21" } },
  ],
};

/** A 200 whose body is JSON but not a Valet observations response. */
export const valetMalformedFixture = { message: "Bad series name", docs: "https://…" };

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}
