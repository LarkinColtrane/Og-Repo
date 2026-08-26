import type { BoroughPermitStat, PermitCategory } from "@/types/civic";
import { PERMIT_CATEGORIES } from "@/types/civic";
import type { Period } from "@/types";
import { MONTREAL_MUNICIPALITIES } from "@/lib/geo/montreal";
import { addMonths, toPeriod } from "@/lib/periods";

/**
 * ⚠️ DEMONSTRATION DATA — NOT REAL PERMIT COUNTS ⚠️
 *
 * Generated borough-month permit activity, so the supply view has something
 * coherent to render before the Ville de Montréal connector is importing.
 *
 * Two properties make it safe to have here:
 *
 *  1. **Its source id is `src-demo-permits`**, not the Ville de Montréal. A
 *     generated number attributed to a real publisher is precisely the
 *     fabrication the provenance system exists to prevent.
 *  2. **`dataQuality` is `demo`**, set by the repository rather than by a
 *     component prop, so there is no path by which it appears unlabelled.
 *
 * Generated rather than committed as JSON so the file stays a few dozen lines
 * instead of thousands of rows, and so the series always runs up to the current
 * month.
 *
 * The shape is plausible — bigger boroughs issue more permits, renovations
 * dominate, winter is quieter than summer — because a generator that produces
 * uniform noise makes every chart look broken and teaches a reader nothing. It
 * is still invented.
 */

export const DEMO_PERMIT_SOURCE_ID = "src-demo-permits";

/** How much history the fallback generates. */
const DEMO_HISTORY_MONTHS = 60;

/**
 * Relative size of each borough, used to scale its permit volume.
 *
 * Loosely ordered by population and building stock so the ranking is not
 * absurd. Not a measurement of anything.
 */
const BOROUGH_SCALE: Record<string, number> = {
  "cote-des-neiges-notre-dame-de-grace": 1.0,
  "mercier-hochelaga-maisonneuve": 0.95,
  "villeray-saint-michel-parc-extension": 0.85,
  "rosemont-la-petite-patrie": 0.85,
  "ville-marie": 0.8,
  "le-plateau-mont-royal": 0.75,
  "ahuntsic-cartierville": 0.75,
  "saint-laurent": 0.7,
  "riviere-des-prairies-pointe-aux-trembles": 0.65,
  "le-sud-ouest": 0.6,
  "montreal-nord": 0.55,
  "saint-leonard": 0.5,
  lasalle: 0.5,
  verdun: 0.45,
  "pierrefonds-roxboro": 0.4,
  anjou: 0.35,
  lachine: 0.35,
  outremont: 0.2,
  "l-ile-bizard-sainte-genevieve": 0.15,
  westmount: 0.2,
};

/** Small, fast, seedable PRNG — the same one the other demo generators use. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashString(value: string): number {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/**
 * Montréal's construction season is real and pronounced: permits cluster into
 * spring and summer because nobody starts a roof in February. Modelling it
 * keeps the demo chart from looking like a random walk, which would teach a
 * reader the wrong thing about what a permit series looks like.
 */
const SEASONAL_FACTOR = [
  0.55, 0.6, 0.85, 1.15, 1.35, 1.4, 1.3, 1.25, 1.2, 1.05, 0.8, 0.6,
];

let cache: BoroughPermitStat[] | null = null;

/** Every generated borough-month, ascending by period then borough. */
export function demoPermitStats(): BoroughPermitStat[] {
  if (cache) return cache;

  const now = new Date();
  const latest = toPeriod(now.getUTCFullYear(), now.getUTCMonth() + 1);
  const retrievedAt = `${latest}-01T00:00:00.000Z`;

  const stats: BoroughPermitStat[] = [];

  for (const municipality of MONTREAL_MUNICIPALITIES) {
    const scale = BOROUGH_SCALE[municipality.code] ?? 0.3;
    const random = mulberry32(hashString(`demo-permits:${municipality.code}`));

    for (let offset = DEMO_HISTORY_MONTHS - 1; offset >= 0; offset -= 1) {
      const period = addMonths(latest, -offset);
      const month = Number(period.slice(5, 7));
      const seasonal = SEASONAL_FACTOR[month - 1];

      // A gentle upward drift over five years, plus month-to-month noise.
      const drift = 1 + ((DEMO_HISTORY_MONTHS - offset) / DEMO_HISTORY_MONTHS) * 0.18;
      const noise = 0.82 + random() * 0.36;
      const permitsIssued = Math.max(1, Math.round(120 * scale * seasonal * drift * noise));

      const byCategory = splitCategories(permitsIssued, random);
      // Roughly two dwellings per new-construction permit, which is what a
      // borough of duplexes and triplexes looks like.
      const dwellingUnitsCreated = Math.round(
        byCategory["new-construction"] * (1.4 + random() * 1.6),
      );

      stats.push({
        boroughCode: municipality.code,
        period: period as Period,
        permitsIssued,
        dwellingUnitsCreated,
        declaredWorkValue: Math.round(
          byCategory["new-construction"] * 420_000 +
            byCategory.renovation * 85_000 +
            byCategory.demolition * 30_000,
        ),
        byCategory,
        dataSourceId: DEMO_PERMIT_SOURCE_ID,
        retrievedAt,
        dataQuality: "demo",
      });
    }
  }

  cache = stats.sort(
    (a, b) => a.period.localeCompare(b.period) || a.boroughCode.localeCompare(b.boroughCode),
  );
  return cache;
}

/**
 * Split a permit total into categories that sum back to it exactly.
 *
 * The remainder goes to `renovation` rather than being rounded away, so the
 * breakdown always adds up — the validator enforces that, and generated data
 * that could not pass its own validator would be a poor stand-in for real data.
 */
function splitCategories(
  total: number,
  random: () => number,
): Record<PermitCategory, number> {
  const newConstruction = Math.round(total * (0.06 + random() * 0.06));
  const demolition = Math.round(total * (0.01 + random() * 0.02));
  const other = Math.round(total * (0.03 + random() * 0.04));
  const renovation = Math.max(0, total - newConstruction - demolition - other);

  const counts = {
    "new-construction": newConstruction,
    renovation,
    demolition,
    other,
  } as Record<PermitCategory, number>;

  // Defensive: if rounding ever overshot the total, take it back off `other`.
  const sum = PERMIT_CATEGORIES.reduce((acc, category) => acc + counts[category], 0);
  if (sum !== total) counts.other += total - sum;

  return counts;
}
