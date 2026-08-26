/**
 * Montréal geography, normalized.
 *
 * ## Why this layer exists at all
 *
 * Open data arrives with place names as free text, and free text is not a key.
 * One publisher writes `Le Plateau-Mont-Royal`, another `PLATEAU-MONT-ROYAL`,
 * another `Arrondissement du Plateau-Mont-Royal`, and a fourth loses the accents
 * on the way through a CSV export. Joining on any of those strings directly
 * produces a table that silently drops rows — the worst kind of data bug,
 * because the total still looks plausible.
 *
 * So every external place name goes through `normalizeBoroughName` before it
 * touches storage, and the result is a **code**, not a string.
 *
 * ## The rule that matters more than the code
 *
 * > ### A borough is not a neighbourhood
 *
 * Montréal has 19 *arrondissements* (boroughs) plus 15 *villes liées* (linked
 * cities) in the agglomeration. This platform talks about **neighbourhoods**,
 * which are smaller, informal, and do not nest cleanly:
 *
 *   - **Griffintown** and **Saint-Henri** are both inside **Le Sud-Ouest**. A
 *     Sud-Ouest statistic describes neither of them individually.
 *   - **Verdun** the neighbourhood and **Verdun** the borough are effectively
 *     the same territory. There, borough data *is* the neighbourhood.
 *   - **Westmount** is not a borough at all. It is an independent municipality
 *     that Montréal happens to surround.
 *
 * A statistic published per borough therefore may **never** be relabelled as a
 * neighbourhood statistic. `NEIGHBOURHOOD_BOROUGH_LINKS` records, per
 * neighbourhood, exactly what the relationship is, and `coverage` is what the
 * interface reads to decide whether it may say "Verdun" or must say "the borough
 * this neighbourhood sits in".
 *
 * ## What this file does not do
 *
 * It contains **no boundaries**. Not one coordinate pair. Borough outlines are
 * published as GeoJSON by the Ville de Montréal and would have to be ingested
 * like any other dataset; approximating them from a bounding box or a radius
 * would produce a map that is confidently wrong. `NeighbourhoodBoundary` in
 * `types/neighbourhood.ts` is the shape they will land in when they are real.
 */

/** Stable internal identifier for a borough or linked city. */
export type BoroughCode = string;

export type MunicipalityKind =
  /** An arrondissement of the Ville de Montréal. */
  | "borough"
  /** An independent municipality within the agglomeration (a *ville liée*). */
  | "linked-city";

export interface Municipality {
  code: BoroughCode;
  /** Official name, with the typography the city itself uses. */
  name: string;
  kind: MunicipalityKind;
  /**
   * Spellings observed in published data.
   *
   * Matching is done on a folded form (accents stripped, case and punctuation
   * normalized), so these do not need to list every casing — they exist for
   * genuinely different renderings: an `Arrondissement de` prefix, a hyphen
   * where the official name uses an en dash, an abbreviation.
   */
  aliases: string[];
}

/**
 * The 19 boroughs, plus the linked cities this platform currently references.
 *
 * Not the full agglomeration: adding a linked city is one entry here, and
 * nothing else changes. Names use the city's own typography — `Rosemont–La
 * Petite-Patrie` carries an en dash (U+2013), not a hyphen, and matching folds
 * both so data using either joins correctly.
 */
export const MONTREAL_MUNICIPALITIES: readonly Municipality[] = [
  { code: "ahuntsic-cartierville", name: "Ahuntsic-Cartierville", kind: "borough", aliases: [] },
  { code: "anjou", name: "Anjou", kind: "borough", aliases: [] },
  {
    code: "cote-des-neiges-notre-dame-de-grace",
    name: "Côte-des-Neiges–Notre-Dame-de-Grâce",
    kind: "borough",
    aliases: ["CDN-NDG", "Cote-des-Neiges - Notre-Dame-de-Grace"],
  },
  { code: "lachine", name: "Lachine", kind: "borough", aliases: [] },
  { code: "lasalle", name: "LaSalle", kind: "borough", aliases: [] },
  { code: "le-plateau-mont-royal", name: "Le Plateau-Mont-Royal", kind: "borough", aliases: ["Plateau-Mont-Royal", "Plateau Mont-Royal"] },
  { code: "le-sud-ouest", name: "Le Sud-Ouest", kind: "borough", aliases: ["Sud-Ouest"] },
  { code: "l-ile-bizard-sainte-genevieve", name: "L'Île-Bizard–Sainte-Geneviève", kind: "borough", aliases: ["Ile-Bizard - Sainte-Genevieve"] },
  {
    code: "mercier-hochelaga-maisonneuve",
    name: "Mercier–Hochelaga-Maisonneuve",
    kind: "borough",
    aliases: ["Mercier - Hochelaga-Maisonneuve", "MHM"],
  },
  { code: "montreal-nord", name: "Montréal-Nord", kind: "borough", aliases: [] },
  { code: "outremont", name: "Outremont", kind: "borough", aliases: [] },
  { code: "pierrefonds-roxboro", name: "Pierrefonds-Roxboro", kind: "borough", aliases: [] },
  { code: "riviere-des-prairies-pointe-aux-trembles", name: "Rivière-des-Prairies–Pointe-aux-Trembles", kind: "borough", aliases: ["RDP-PAT", "Riviere-des-Prairies - Pointe-aux-Trembles"] },
  { code: "rosemont-la-petite-patrie", name: "Rosemont–La Petite-Patrie", kind: "borough", aliases: ["Rosemont - La Petite-Patrie", "Rosemont-La Petite-Patrie"] },
  { code: "saint-laurent", name: "Saint-Laurent", kind: "borough", aliases: ["St-Laurent"] },
  { code: "saint-leonard", name: "Saint-Léonard", kind: "borough", aliases: ["St-Leonard"] },
  { code: "verdun", name: "Verdun", kind: "borough", aliases: [] },
  { code: "ville-marie", name: "Ville-Marie", kind: "borough", aliases: [] },
  {
    code: "villeray-saint-michel-parc-extension",
    name: "Villeray–Saint-Michel–Parc-Extension",
    kind: "borough",
    aliases: ["Villeray - Saint-Michel - Parc-Extension", "VSMPE"],
  },

  // Linked cities referenced by this platform's neighbourhoods. The
  // agglomeration has fifteen; the rest are added the same way, one line each.
  { code: "westmount", name: "Westmount", kind: "linked-city", aliases: ["Ville de Westmount"] },
];

const BY_CODE = new Map(MONTREAL_MUNICIPALITIES.map((m) => [m.code, m]));

/**
 * Fold a place name to a comparison key.
 *
 * Strips accents, lowercases, collapses every kind of dash and separator to a
 * single hyphen, and drops an `arrondissement de/du/d'` prefix. Two names that
 * fold to the same key are the same place — that is the whole contract, and it
 * is why matching does not need an alias for every casing.
 */
export function foldPlaceName(value: string): string {
  return value
    .normalize("NFD")
    // Combining diacritical marks: é → e, ô → o, and so on.
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/^arrondissement\s+(de\s+la\s+|de\s+|du\s+|des\s+|d')/, "")
    .replace(/^ville\s+de\s+/, "")
    // En dash, em dash, non-breaking hyphen, slash, apostrophe, whitespace.
    .replace(/[‐-―−/'’\s_.]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

const BY_FOLDED = new Map<string, Municipality>();
for (const municipality of MONTREAL_MUNICIPALITIES) {
  BY_FOLDED.set(foldPlaceName(municipality.name), municipality);
  BY_FOLDED.set(foldPlaceName(municipality.code), municipality);
  for (const alias of municipality.aliases) {
    BY_FOLDED.set(foldPlaceName(alias), municipality);
  }
}

export interface BoroughMatch {
  municipality: Municipality;
  /** How the name was recognised, for the import report. */
  matchedBy: "name" | "alias" | "code";
}

/**
 * Resolve a published place name to a known municipality.
 *
 * **Returns `null` rather than guessing.** No fuzzy matching, no nearest
 * neighbour, no "close enough". An unrecognised borough name means the feed has
 * changed or contains a place this registry does not know, and the honest
 * outcome is a rejected row that appears in the import report — not a row
 * quietly filed under whichever borough had the shortest edit distance.
 */
export function normalizeBoroughName(raw: string | null | undefined): BoroughMatch | null {
  if (!raw) return null;
  const folded = foldPlaceName(String(raw));
  if (!folded) return null;

  const municipality = BY_FOLDED.get(folded);
  if (!municipality) return null;

  if (folded === foldPlaceName(municipality.name)) {
    return { municipality, matchedBy: "name" };
  }
  if (folded === foldPlaceName(municipality.code)) {
    return { municipality, matchedBy: "code" };
  }
  return { municipality, matchedBy: "alias" };
}

export function getMunicipality(code: BoroughCode): Municipality | null {
  return BY_CODE.get(code) ?? null;
}

/* ── Neighbourhoods ↔ boroughs ────────────────────────────────────────────── */

/**
 * How much of a borough a neighbourhood accounts for.
 *
 * This is the field that decides what the interface is allowed to say.
 */
export type BoroughCoverage =
  /**
   * The neighbourhood and the municipality are effectively the same territory.
   * A borough statistic describes this neighbourhood directly.
   */
  | "coextensive"
  /**
   * The neighbourhood is one part of a larger borough. A borough statistic
   * includes it but also includes places that are not it, and must be presented
   * as a borough figure — never relabelled with the neighbourhood's name.
   */
  | "part-of";

export interface NeighbourhoodBoroughLink {
  /** Slug in `data/demo/neighbourhood-profiles.ts`. */
  neighbourhoodSlug: string;
  boroughCode: BoroughCode;
  coverage: BoroughCoverage;
  /**
   * One sentence a reader can act on, shown wherever borough data appears under
   * a neighbourhood heading. Written per link because the caveat differs: two
   * neighbourhoods sharing a borough is a different problem from a
   * neighbourhood that *is* its borough.
   */
  note: string;
}

/**
 * The explicit mapping. Nothing is inferred from a name matching.
 *
 * Griffintown and Saint-Henri are the case worth reading twice: both are
 * `part-of` `le-sud-ouest`, so a Sud-Ouest permit count appears under both
 * neighbourhoods, described as a Sud-Ouest figure, in both places. Showing it as
 * "Griffintown: 412 permits" would be a fabricated statistic — the borough
 * number counts Saint-Henri, Pointe-Saint-Charles and Ville-Émard too.
 */
export const NEIGHBOURHOOD_BOROUGH_LINKS: readonly NeighbourhoodBoroughLink[] = [
  {
    neighbourhoodSlug: "plateau-mont-royal",
    boroughCode: "le-plateau-mont-royal",
    coverage: "coextensive",
    note: "The Plateau neighbourhood and the borough of Le Plateau-Mont-Royal cover substantially the same territory.",
  },
  {
    neighbourhoodSlug: "rosemont-la-petite-patrie",
    boroughCode: "rosemont-la-petite-patrie",
    coverage: "coextensive",
    note: "This neighbourhood covers substantially the whole borough of Rosemont–La Petite-Patrie.",
  },
  {
    neighbourhoodSlug: "ville-marie",
    boroughCode: "ville-marie",
    coverage: "coextensive",
    note: "Ville-Marie is both the borough and the downtown area described here.",
  },
  {
    neighbourhoodSlug: "griffintown",
    boroughCode: "le-sud-ouest",
    coverage: "part-of",
    note: "Griffintown is one part of the borough of Le Sud-Ouest. Borough figures also cover Saint-Henri, Pointe-Saint-Charles, Ville-Émard and Côte-Saint-Paul.",
  },
  {
    neighbourhoodSlug: "saint-henri",
    boroughCode: "le-sud-ouest",
    coverage: "part-of",
    note: "Saint-Henri is one part of the borough of Le Sud-Ouest. Borough figures also cover Griffintown, Pointe-Saint-Charles, Ville-Émard and Côte-Saint-Paul.",
  },
  {
    neighbourhoodSlug: "verdun",
    boroughCode: "verdun",
    coverage: "coextensive",
    note: "The borough of Verdun covers this neighbourhood and Île-des-Sœurs.",
  },
  {
    neighbourhoodSlug: "ahuntsic",
    boroughCode: "ahuntsic-cartierville",
    coverage: "part-of",
    note: "Ahuntsic is the eastern part of the borough of Ahuntsic-Cartierville. Borough figures also cover Cartierville and Bordeaux.",
  },
  {
    neighbourhoodSlug: "villeray",
    boroughCode: "villeray-saint-michel-parc-extension",
    coverage: "part-of",
    note: "Villeray is one of three districts in its borough. Borough figures also cover Saint-Michel and Parc-Extension, which have quite different housing stock.",
  },
  {
    neighbourhoodSlug: "cote-des-neiges",
    boroughCode: "cote-des-neiges-notre-dame-de-grace",
    coverage: "part-of",
    note: "Côte-des-Neiges is one half of its borough. Borough figures also cover Notre-Dame-de-Grâce.",
  },
  {
    neighbourhoodSlug: "outremont",
    boroughCode: "outremont",
    coverage: "coextensive",
    note: "Outremont the neighbourhood and Outremont the borough are the same territory.",
  },
  {
    neighbourhoodSlug: "westmount",
    boroughCode: "westmount",
    coverage: "coextensive",
    note: "Westmount is an independent municipality, not a Montréal borough. Its figures come from the city of Westmount, not from a Ville de Montréal borough.",
  },
  {
    neighbourhoodSlug: "hochelaga-maisonneuve",
    boroughCode: "mercier-hochelaga-maisonneuve",
    coverage: "part-of",
    note: "Hochelaga-Maisonneuve is the western part of the borough of Mercier–Hochelaga-Maisonneuve. Borough figures also cover Mercier.",
  },
];

const LINKS_BY_SLUG = new Map(
  NEIGHBOURHOOD_BOROUGH_LINKS.map((link) => [link.neighbourhoodSlug, link]),
);

export function getBoroughLink(neighbourhoodSlug: string): NeighbourhoodBoroughLink | null {
  return LINKS_BY_SLUG.get(neighbourhoodSlug) ?? null;
}

/** Every neighbourhood that a borough's statistics are relevant to. */
export function neighbourhoodsInBorough(code: BoroughCode): NeighbourhoodBoroughLink[] {
  return NEIGHBOURHOOD_BOROUGH_LINKS.filter((link) => link.boroughCode === code);
}

/**
 * How a borough figure must be labelled when shown under a neighbourhood.
 *
 * Returns the borough's own name whenever the neighbourhood is only part of it,
 * so the interface physically cannot print a neighbourhood name over a borough
 * number — the label comes from here, not from the page.
 */
export function describeBoroughAttribution(link: NeighbourhoodBoroughLink): {
  label: string;
  qualifier: string;
  note: string;
} {
  const municipality = getMunicipality(link.boroughCode);
  const name = municipality?.name ?? link.boroughCode;

  if (link.coverage === "coextensive") {
    return {
      label: name,
      qualifier:
        municipality?.kind === "linked-city" ? "City-wide figure" : "Borough-wide figure",
      note: link.note,
    };
  }

  return {
    label: name,
    qualifier: "Borough-wide figure — wider than this neighbourhood",
    note: link.note,
  };
}
