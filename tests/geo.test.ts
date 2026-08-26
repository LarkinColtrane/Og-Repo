import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  MONTREAL_MUNICIPALITIES,
  NEIGHBOURHOOD_BOROUGH_LINKS,
  describeBoroughAttribution,
  foldPlaceName,
  getBoroughLink,
  getMunicipality,
  neighbourhoodsInBorough,
  normalizeBoroughName,
} from "@/lib/geo/montreal";
import { NEIGHBOURHOOD_SEEDS } from "@/data/demo/neighbourhood-profiles";

/**
 * The geographic normalization layer.
 *
 * These tests exist because "borough = neighbourhood" is the single easiest
 * mistake to make with Montréal open data, and the one that produces the most
 * confident-looking wrong numbers.
 */

describe("normalizeBoroughName", () => {
  it("matches the official name exactly", () => {
    const match = normalizeBoroughName("Le Plateau-Mont-Royal");
    assert.equal(match?.municipality.code, "le-plateau-mont-royal");
    assert.equal(match?.matchedBy, "name");
  });

  it("folds accents", () => {
    assert.equal(
      normalizeBoroughName("COTE-DES-NEIGES - NOTRE-DAME-DE-GRACE")?.municipality.code,
      "cote-des-neiges-notre-dame-de-grace",
    );
    assert.equal(
      normalizeBoroughName("Côte-des-Neiges–Notre-Dame-de-Grâce")?.municipality.code,
      "cote-des-neiges-notre-dame-de-grace",
    );
  });

  it("folds an en dash and a hyphen to the same key", () => {
    // The city writes Rosemont–La Petite-Patrie with an en dash (U+2013).
    // Exports routinely use a hyphen or a spaced hyphen. All three are one place.
    const codes = [
      "Rosemont–La Petite-Patrie",
      "Rosemont-La Petite-Patrie",
      "ROSEMONT — LA PETITE-PATRIE",
    ].map((name) => normalizeBoroughName(name)?.municipality.code);
    assert.deepEqual(new Set(codes), new Set(["rosemont-la-petite-patrie"]));
  });

  it("strips an `Arrondissement de` prefix", () => {
    assert.equal(
      normalizeBoroughName("Arrondissement de Verdun")?.municipality.code,
      "verdun",
    );
  });

  it("strips a `Ville de` prefix", () => {
    assert.equal(normalizeBoroughName("Ville de Westmount")?.municipality.code, "westmount");
  });

  it("matches a declared alias", () => {
    const match = normalizeBoroughName("ST-LEONARD");
    assert.equal(match?.municipality.code, "saint-leonard");
    assert.equal(match?.matchedBy, "alias");
  });

  it("returns null for a place outside the agglomeration, rather than guessing", () => {
    // Laval and Longueuil are neighbouring cities, not Montréal boroughs. A
    // fuzzy matcher would find "Lachine" a short edit away from "Laval".
    for (const outsider of ["Laval", "Longueuil", "Brossard", "Toronto"]) {
      assert.equal(normalizeBoroughName(outsider), null, outsider);
    }
  });

  it("returns null for empty and missing values", () => {
    assert.equal(normalizeBoroughName(""), null);
    assert.equal(normalizeBoroughName(null), null);
    assert.equal(normalizeBoroughName(undefined), null);
    assert.equal(normalizeBoroughName("   "), null);
  });

  it("every registered municipality resolves from its own name and code", () => {
    for (const municipality of MONTREAL_MUNICIPALITIES) {
      assert.equal(
        normalizeBoroughName(municipality.name)?.municipality.code,
        municipality.code,
        municipality.name,
      );
      assert.equal(
        normalizeBoroughName(municipality.code)?.municipality.code,
        municipality.code,
        municipality.code,
      );
    }
  });

  it("folds to a stable key regardless of separator", () => {
    assert.equal(foldPlaceName("Le  Sud-Ouest"), "le-sud-ouest");
    assert.equal(foldPlaceName("LE SUD OUEST"), "le-sud-ouest");
  });
});

describe("the borough registry", () => {
  it("holds the 19 boroughs plus the linked cities this platform references", () => {
    const boroughs = MONTREAL_MUNICIPALITIES.filter((m) => m.kind === "borough");
    assert.equal(boroughs.length, 19, "Montréal has 19 arrondissements");
  });

  it("marks Westmount as a linked city, not a borough", () => {
    // It is an independent municipality that Montréal surrounds. Calling it a
    // borough would be factually wrong, and the interface says "City-wide"
    // rather than "Borough-wide" because of this flag.
    assert.equal(getMunicipality("westmount")?.kind, "linked-city");
  });

  it("has no duplicate codes", () => {
    const codes = MONTREAL_MUNICIPALITIES.map((m) => m.code);
    assert.equal(new Set(codes).size, codes.length);
  });
});

describe("neighbourhood ↔ borough links", () => {
  it("maps every neighbourhood in the seed table", () => {
    for (const seed of NEIGHBOURHOOD_SEEDS) {
      assert.ok(
        getBoroughLink(seed.slug),
        `${seed.slug} has no borough link — borough data must not be shown for it`,
      );
    }
  });

  it("points every link at a registered municipality", () => {
    for (const link of NEIGHBOURHOOD_BOROUGH_LINKS) {
      assert.ok(
        getMunicipality(link.boroughCode),
        `${link.neighbourhoodSlug} → ${link.boroughCode} is not a known municipality`,
      );
    }
  });

  it("records two neighbourhoods sharing one borough", () => {
    // The case that makes the whole layer necessary.
    const sudOuest = neighbourhoodsInBorough("le-sud-ouest").map((l) => l.neighbourhoodSlug);
    assert.deepEqual(sudOuest.sort(), ["griffintown", "saint-henri"]);
    for (const slug of sudOuest) {
      assert.equal(getBoroughLink(slug)?.coverage, "part-of");
    }
  });

  it("marks a neighbourhood coextensive with its borough", () => {
    assert.equal(getBoroughLink("verdun")?.coverage, "coextensive");
    assert.equal(getBoroughLink("outremont")?.coverage, "coextensive");
  });

  it("every `part-of` note names what else the borough contains", () => {
    // A generic disclaimer teaches nothing. The note has to say which other
    // places are in the number, or a reader cannot judge it.
    for (const link of NEIGHBOURHOOD_BOROUGH_LINKS) {
      if (link.coverage !== "part-of") continue;
      assert.match(
        link.note,
        /also cover/,
        `${link.neighbourhoodSlug} note does not say what else is included`,
      );
    }
  });
});

describe("describeBoroughAttribution", () => {
  it("labels a part-of figure with the BOROUGH name, never the neighbourhood", () => {
    const link = getBoroughLink("griffintown");
    assert.ok(link);
    const described = describeBoroughAttribution(link);

    assert.equal(described.label, "Le Sud-Ouest");
    assert.ok(
      !described.label.toLowerCase().includes("griffintown"),
      "a borough figure must never be captioned with a neighbourhood name",
    );
    assert.match(described.qualifier, /wider than this neighbourhood/);
  });

  it("says `Borough-wide` for a borough and `City-wide` for a linked city", () => {
    const verdun = getBoroughLink("verdun");
    const westmount = getBoroughLink("westmount");
    assert.ok(verdun && westmount);
    assert.match(describeBoroughAttribution(verdun).qualifier, /^Borough-wide/);
    assert.match(describeBoroughAttribution(westmount).qualifier, /^City-wide/);
  });

  it("carries the note through to the caption", () => {
    const link = getBoroughLink("saint-henri");
    assert.ok(link);
    assert.equal(describeBoroughAttribution(link).note, link.note);
  });
});
