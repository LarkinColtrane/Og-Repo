"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { usePathname } from "next/navigation";
import type { Neighbourhood } from "@/types";
import { createPersistentStore } from "@/lib/persistent-store";

/**
 * The neighbourhood the whole app is currently "looking at".
 *
 * Rent, Buy, Sell and Invest all answer questions about one area, and a reader
 * moving between them expects their choice to follow. Holding it in context —
 * rather than in each page's own state — is what makes the header selector update
 * every dashboard at once.
 *
 * The selection is backed by `localStorage` through an external store rather than
 * by `useState` plus a mount effect. That is not a stylistic preference: reading
 * storage in an effect renders once with the default and then again with the stored
 * value, which shows up as the selector visibly changing after load.
 *
 * `/neighbourhoods/[slug]` is the exception — there the URL identifies the area, so
 * the effect below pushes the path's slug into the store, and every other surface
 * follows.
 */

interface NeighbourhoodContextValue {
  neighbourhoods: Neighbourhood[];
  selectedSlug: string;
  selected: Neighbourhood | undefined;
  setSelectedSlug: (slug: string) => void;
}

const NeighbourhoodContext = createContext<NeighbourhoodContextValue | null>(null);

const isNonEmpty = (value: string): value is string => value.length > 0;
const selectionStore = createPersistentStore("mtl-market-neighbourhood", isNonEmpty);

function slugFromPathname(pathname: string | null): string | null {
  const match = /^\/neighbourhoods\/([^/]+)/.exec(pathname ?? "");
  return match?.[1] ?? null;
}

export function NeighbourhoodProvider({
  neighbourhoods,
  defaultSlug,
  children,
}: {
  neighbourhoods: Neighbourhood[];
  defaultSlug: string;
  children: ReactNode;
}) {
  const pathname = usePathname();

  const storedSlug = useSyncExternalStore(
    selectionStore.subscribe,
    selectionStore.get,
    // The server has no storage, so it renders the default — and so does the
    // hydrating client render, which is what keeps the markup identical.
    () => null,
  );

  // Viewing a dashboard directly should update the selection everywhere else.
  // Writing to an external store is a legitimate effect: it synchronises React
  // state *out* to something else, rather than feeding it back in.
  const pathSlug = slugFromPathname(pathname);
  useEffect(() => {
    if (pathSlug && neighbourhoods.some((entry) => entry.slug === pathSlug)) {
      selectionStore.set(pathSlug);
    }
  }, [pathSlug, neighbourhoods]);

  const selectedSlug =
    storedSlug && neighbourhoods.some((entry) => entry.slug === storedSlug)
      ? storedSlug
      : defaultSlug;

  const setSelectedSlug = useCallback((slug: string) => {
    selectionStore.set(slug);
  }, []);

  const value = useMemo<NeighbourhoodContextValue>(
    () => ({
      neighbourhoods,
      selectedSlug,
      selected: neighbourhoods.find((entry) => entry.slug === selectedSlug),
      setSelectedSlug,
    }),
    [neighbourhoods, selectedSlug, setSelectedSlug],
  );

  return (
    <NeighbourhoodContext.Provider value={value}>
      {children}
    </NeighbourhoodContext.Provider>
  );
}

export function useNeighbourhoods(): NeighbourhoodContextValue {
  const context = useContext(NeighbourhoodContext);
  if (!context) {
    throw new Error("useNeighbourhoods must be used inside a NeighbourhoodProvider.");
  }
  return context;
}
