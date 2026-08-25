"use client";

import { useCallback, useSyncExternalStore } from "react";
import type { ResolvedTheme } from "@/components/charts/chart-theme";
import { createPersistentStore } from "@/lib/persistent-store";

export type ThemePreference = "light" | "dark" | "system";

const STORAGE_KEY = "mtl-market-theme";

function isThemePreference(value: string): value is ThemePreference {
  return value === "light" || value === "dark" || value === "system";
}

const preferenceStore = createPersistentStore(STORAGE_KEY, isThemePreference);

/**
 * Subscribes to the two things that decide the rendered theme: the explicit
 * `data-theme` attribute on `<html>`, and the OS `prefers-color-scheme` setting.
 */
function subscribeToTheme(onChange: () => void): () => void {
  const media = window.matchMedia("(prefers-color-scheme: dark)");
  media.addEventListener("change", onChange);

  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-theme"],
  });

  return () => {
    media.removeEventListener("change", onChange);
    observer.disconnect();
  };
}

function readResolvedTheme(): ResolvedTheme {
  const explicit = document.documentElement.getAttribute("data-theme");
  if (explicit === "dark" || explicit === "light") return explicit;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

/**
 * The theme the page is actually rendering in.
 *
 * Charts need the resolved answer because their colours are SVG attributes rather
 * than CSS custom properties — a stylesheet cannot re-colour a rendered chart.
 * Everything else in the app themes itself through CSS and does not need this.
 */
export function useResolvedTheme(): ResolvedTheme {
  return useSyncExternalStore(
    subscribeToTheme,
    readResolvedTheme,
    // Server rendering has no window; charts hold off until `useIsClient` is true,
    // so this value is never actually painted.
    () => "light" as const,
  );
}

/** Reads and writes the stored preference behind the theme toggle. */
export function useThemePreference(): [ThemePreference, (next: ThemePreference) => void] {
  const preference =
    useSyncExternalStore(
      preferenceStore.subscribe,
      preferenceStore.get,
      () => null,
    ) ?? "system";

  const update = useCallback((next: ThemePreference) => {
    preferenceStore.set(next);
    // The attribute is what the CSS reads; the stored value only survives reloads.
    if (next === "system") document.documentElement.removeAttribute("data-theme");
    else document.documentElement.setAttribute("data-theme", next);
  }, []);

  return [preference, update];
}

/**
 * Runs before first paint to apply the stored preference, so a dark-mode visitor
 * never sees a flash of the light theme. Injected as an inline script in the root
 * layout — it has to be synchronous and ahead of hydration to do its job.
 */
export const THEME_INIT_SCRIPT = `
try {
  var stored = localStorage.getItem('${STORAGE_KEY}');
  if (stored === 'light' || stored === 'dark') {
    document.documentElement.setAttribute('data-theme', stored);
  }
} catch (e) {}
`;
