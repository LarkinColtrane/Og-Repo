import { en, type Dictionary } from "./dictionaries/en";
import { fr } from "./dictionaries/fr";
import type { DeepPartial } from "./types";

export type { Dictionary } from "./dictionaries/en";
export type { DeepPartial } from "./types";

export type Locale = "en" | "fr";

export const LOCALES: Locale[] = ["en", "fr"];
export const DEFAULT_LOCALE: Locale = "en";

const DICTIONARIES: Record<Locale, DeepPartial<Dictionary>> = { en, fr };

/**
 * Merge a partial translation over the English reference.
 *
 * Falling back per *key* rather than per *locale* means a half-finished French
 * build shows French where it exists and English elsewhere, instead of refusing to
 * render or showing blanks.
 */
function mergeDictionary<T>(base: T, overrides: DeepPartial<T> | undefined): T {
  if (!overrides) return base;

  const result = { ...base } as T;
  for (const key of Object.keys(overrides) as Array<keyof T>) {
    const override = overrides[key as keyof DeepPartial<T>];
    if (override === undefined) continue;

    const baseValue = base[key];
    if (
      baseValue !== null &&
      typeof baseValue === "object" &&
      !Array.isArray(baseValue) &&
      typeof override === "object"
    ) {
      result[key] = mergeDictionary(baseValue, override as DeepPartial<typeof baseValue>);
    } else {
      result[key] = override as T[keyof T];
    }
  }
  return result;
}

const cache = new Map<Locale, Dictionary>();

export function getDictionary(locale: Locale = DEFAULT_LOCALE): Dictionary {
  const cached = cache.get(locale);
  if (cached) return cached;

  const dictionary = mergeDictionary(en, DICTIONARIES[locale]);
  cache.set(locale, dictionary);
  return dictionary;
}

/**
 * Fill `{placeholders}` in a dictionary string.
 *
 * `interpolate(copy.home.snapshotSubtitle, { period: "Jun. 2026" })`
 */
export function interpolate(
  template: string,
  values: Record<string, string | number>,
): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) =>
    key in values ? String(values[key]) : match,
  );
}

/**
 * The active dictionary.
 *
 * The app is English-only for now, so components import this constant directly and
 * stay free of prop-drilling. When locale routing arrives (`/fr/...` segments, or a
 * cookie), this constant is replaced by a React context reading the same
 * `getDictionary()` — the call sites stay as they are.
 */
export const copy: Dictionary = getDictionary(DEFAULT_LOCALE);
