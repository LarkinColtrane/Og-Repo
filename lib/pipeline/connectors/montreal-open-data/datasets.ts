import type { CkanField } from "./types";
import type { PermitCategory } from "@/types/civic";

/**
 * The dataset registry, and the **field contract**.
 *
 * ## The problem this solves
 *
 * CKAN standardises the *transport* — `datastore_search`, pagination, the
 * `{success, result}` envelope — but says nothing about column names. A
 * municipal dataset's columns are a per-dataset fact, they are in French, and
 * they change when a publisher reorganises an export.
 *
 * The tempting approach is `record.arrondissement`. It produces a pipeline that
 * works until the column is renamed, and then silently imports a table of
 * `undefined` boroughs and zero totals — a graph that flatlines for reasons
 * nobody can see.
 *
 * ## The approach taken instead
 *
 * Each logical field declares the column names it will accept, and the
 * normalizer **resolves the contract against the columns the response actually
 * returned** before reading a single row. If a required field matches nothing,
 * the import fails with `schema-mismatch` and reports what it expected against
 * what it got.
 *
 * That converts an unverifiable assumption into a self-reporting one. The
 * pipeline either works on real data or says precisely why it cannot — it never
 * produces confident nonsense.
 *
 * ## ⚠️ Verification status
 *
 * The column names below are **declared from published documentation, not
 * confirmed against a live response.** Outbound access to `donnees.montreal.ca`
 * is blocked by this environment's egress policy, and that restriction was
 * reported rather than worked around. Until someone runs an import from a host
 * that can reach the portal:
 *
 *  - `MONTREAL_PERMITS.fieldsVerified` is `false`;
 *  - the data-source registry entry carries `status: "planned"`;
 *  - the operations dashboard shows the dataset as not yet connected.
 *
 * The first real import either succeeds — in which case flip `fieldsVerified` —
 * or fails with a `schema-mismatch` naming the columns it did find, which is
 * exactly the list needed to correct `candidates` below.
 */

export const MONTREAL_OPEN_DATA_SOURCE_ID = "src-montreal-permits";

export interface FieldContract {
  /** Our name for the field. Used in code and in error messages. */
  logical: string;
  /**
   * Column names to accept, in order of preference. Matched case-insensitively
   * and with accents folded, so `ARRONDISSEMENT` and `arrondissement` both hit.
   */
  candidates: string[];
  /** When true, a dataset lacking every candidate cannot be imported at all. */
  required: boolean;
  description: string;
}

export interface DatasetDefinition {
  /** Our stable identifier. */
  code: string;
  /** The CKAN dataset slug, used with `package_show`. */
  packageSlug: string;
  /**
   * The datastore resource id (a UUID) to read rows from.
   *
   * `null` because a resource id is assigned by the portal and cannot be
   * guessed. It is discovered at import time from `package_show`, which is the
   * correct way round: a hard-coded UUID would break the day the publisher
   * re-uploads the resource.
   */
  resourceId: string | null;
  /** Prefer a resource whose name or format matches, when several are queryable. */
  resourceHint?: { format?: string; nameContains?: string };
  title: string;
  sourceId: string;
  licence: string;
  documentationUrl: string;
  /** How often the publisher releases new data. */
  cadence: "daily" | "monthly" | "quarterly" | "annual" | "irregular";
  /**
   * Months after which the newest reporting period is considered stale.
   *
   * Wider than the benchmark series' two business days because municipal
   * publication is irregular: a monthly extract can land three weeks late
   * without anything being wrong.
   */
  maxPeriodLagMonths: number;
  fields: FieldContract[];
  /** False until an import has confirmed the contract against a live response. */
  fieldsVerified: boolean;
}

/**
 * Ville de Montréal construction permits.
 *
 * Chosen over the property assessment roll for three reasons, recorded here
 * because the decision is not obvious:
 *
 *  1. **It is monthly.** It fits the `Period` model, the trend chart and the
 *     existing monthly interface without inventing a second cadence.
 *  2. **It adds a dimension the platform lacks.** Every existing statistic
 *     describes demand — prices, rents, days on market. Permits describe supply.
 *  3. **It does not invite a dangerous misreading.** An assessed value sitting
 *     beside a median sale price will be read as a competing price estimate no
 *     matter how it is labelled. A permit count competes with nothing.
 */
export const MONTREAL_PERMITS: DatasetDefinition = {
  code: "montreal-construction-permits",
  packageSlug: "permis-construction",
  resourceId: null,
  resourceHint: { format: "CSV" },
  title: "Ville de Montréal construction permits",
  sourceId: MONTREAL_OPEN_DATA_SOURCE_ID,
  licence: "Creative Commons Attribution 4.0",
  documentationUrl: "https://donnees.montreal.ca/dataset/permis-construction",
  cadence: "monthly",
  maxPeriodLagMonths: 3,
  fieldsVerified: false,
  fields: [
    {
      logical: "borough",
      candidates: [
        "arrondissement",
        "nom_arrondissement",
        "arrondissement_nom",
        "borough",
      ],
      required: true,
      description:
        "Borough the permit was issued in. Normalized through lib/geo/montreal.ts; an unrecognised value is rejected, never guessed at.",
    },
    {
      logical: "issuedDate",
      candidates: [
        "date_emission",
        "date_delivrance",
        "date_debut",
        "date_permis",
        "issued_date",
      ],
      required: true,
      description:
        "Date the permit was issued. Bucketed to a YYYY-MM reporting period; a row with no parseable date is rejected.",
    },
    {
      logical: "category",
      candidates: [
        "nature_travaux",
        "categorie",
        "type_travaux",
        "description_type_batiment",
        "nature",
      ],
      required: false,
      description:
        "Nature of the authorised work. Mapped to our four categories; anything unrecognised counts as `other` rather than being dropped.",
    },
    {
      logical: "declaredValue",
      candidates: [
        "valeur_travaux",
        "cout_estime",
        "cout_travaux",
        "montant_travaux",
        "valeur",
      ],
      required: false,
      description:
        "Declared value of the work, CAD. A permit-fee input stated by the applicant — not a measured construction cost.",
    },
    {
      logical: "dwellingUnits",
      candidates: [
        "nombre_logements",
        "nb_logements",
        "nombre_logement",
        "logements",
      ],
      required: false,
      description:
        "Dwelling units the permit declares creating. Absent for most renovation permits, which is why it is nullable rather than defaulted to zero.",
    },
  ],
};

export const DATASETS: Record<string, DatasetDefinition> = {
  [MONTREAL_PERMITS.code]: MONTREAL_PERMITS,
};

export function getDataset(code: string): DatasetDefinition | null {
  return DATASETS[code] ?? null;
}

/* ── Resolving the contract ───────────────────────────────────────────────── */

export interface ResolvedFields {
  /** Logical name → the column name actually present in the response. */
  map: Record<string, string>;
  /** Required logical fields that matched nothing. */
  missingRequired: string[];
  /** Optional logical fields that matched nothing. Reported, not fatal. */
  missingOptional: string[];
  /** Every column the response carried, for the mismatch report. */
  observed: string[];
}

/** Fold a column name so `DATE_ÉMISSION` and `date_emission` compare equal. */
export function foldColumnName(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");
}

/**
 * Match the declared contract against the columns a response actually has.
 *
 * Called **once per import, before any row is read**. Finding out on row 40 000
 * that a column was missing is finding out too late — the run has already
 * written 39 999 rows of nothing.
 */
export function resolveFields(
  dataset: DatasetDefinition,
  fields: CkanField[] | undefined,
  sampleRecord?: Record<string, unknown>,
): ResolvedFields {
  // `fields` is the authoritative list, but a portal that omits it still sends
  // records — so fall back to the keys of a row rather than failing outright.
  const observed = fields?.map((field) => field.id) ?? Object.keys(sampleRecord ?? {});
  const byFolded = new Map(observed.map((name) => [foldColumnName(name), name]));

  const map: Record<string, string> = {};
  const missingRequired: string[] = [];
  const missingOptional: string[] = [];

  for (const contract of dataset.fields) {
    const hit = contract.candidates
      .map((candidate) => byFolded.get(foldColumnName(candidate)))
      .find((name): name is string => name !== undefined);

    if (hit) map[contract.logical] = hit;
    else if (contract.required) missingRequired.push(contract.logical);
    else missingOptional.push(contract.logical);
  }

  return { map, missingRequired, missingOptional, observed };
}

/** A report an operator can act on: what was expected, what arrived. */
export function describeSchemaMismatch(
  dataset: DatasetDefinition,
  resolved: ResolvedFields,
): string {
  const expected = resolved.missingRequired
    .map((logical) => {
      const contract = dataset.fields.find((field) => field.logical === logical);
      return `${logical} (tried: ${contract?.candidates.join(", ") ?? "—"})`;
    })
    .join("; ");

  return (
    `The "${dataset.title}" resource does not carry the columns this pipeline requires. ` +
    `Missing: ${expected}. ` +
    `Columns actually present: ${resolved.observed.join(", ") || "(none reported)"}. ` +
    `Nothing was written. Update the field contract in ` +
    `lib/pipeline/connectors/montreal-open-data/datasets.ts to match.`
  );
}

/* ── Category mapping ─────────────────────────────────────────────────────── */

/**
 * Map the publisher's free-text work description to our four categories.
 *
 * Keyword matching on a folded string, checked most-specific first —
 * "démolition partielle" must not be counted as a renovation because it
 * contains neither "renovation" nor "transformation". Anything unrecognised
 * becomes `other`, which is a real bucket: the counts still sum to the permit
 * total, and an unclassified share that starts growing is visible rather than
 * silently draining the other three.
 */
const CATEGORY_KEYWORDS: Array<{ category: PermitCategory; keywords: string[] }> = [
  { category: "demolition", keywords: ["demolition", "demolir", "demol"] },
  {
    category: "new-construction",
    keywords: ["construction", "nouvelle", "nouveau", "batiment_neuf", "neuf", "erection"],
  },
  {
    category: "renovation",
    keywords: [
      "renovation",
      "transformation",
      "modification",
      "agrandissement",
      "reparation",
      "amenagement",
      "renover",
      "alteration",
    ],
  },
];

export function classifyPermitCategory(raw: unknown): PermitCategory {
  if (raw === null || raw === undefined) return "other";
  const folded = foldColumnName(String(raw));
  if (!folded) return "other";

  for (const { category, keywords } of CATEGORY_KEYWORDS) {
    if (keywords.some((keyword) => folded.includes(keyword))) return category;
  }
  return "other";
}
