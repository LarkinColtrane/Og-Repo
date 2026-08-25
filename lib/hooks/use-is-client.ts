"use client";

import { useSyncExternalStore } from "react";

/** No-op subscription: the answer never changes after the first client render. */
const subscribe = () => () => {};

/**
 * `false` during server rendering and the hydrating render, `true` afterwards.
 *
 * Charts need this because their colours depend on the resolved theme, which only
 * the browser knows. `useSyncExternalStore` is the right tool rather than
 * `useState` + `useEffect`: it gives React separate server and client snapshots
 * directly, instead of rendering once with a wrong value and then correcting it
 * with a cascading re-render.
 */
export function useIsClient(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
}
