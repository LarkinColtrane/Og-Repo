/**
 * A tiny observable wrapper around `localStorage`.
 *
 * Why this exists rather than a `useState` + `useEffect` pair: browser storage is
 * an *external* store, and React has a purpose-built hook for those
 * (`useSyncExternalStore`). Reading it in an effect and calling `setState` renders
 * once with the wrong value and then again with the right one — visible as a flash,
 * and flagged by the React Hooks lint rules for exactly that reason.
 *
 * The store also listens for `storage` events, so a preference changed in one tab
 * updates the others.
 */
export interface PersistentStore<T extends string> {
  subscribe(listener: () => void): () => void;
  /** Current value, or null when unset or unreadable. */
  get(): T | null;
  set(value: T | null): void;
}

export function createPersistentStore<T extends string>(
  storageKey: string,
  isValid: (value: string) => value is T,
): PersistentStore<T> {
  const listeners = new Set<() => void>();

  // `undefined` means "not read yet"; `null` means "read, and there is no value".
  // The cache matters: `getSnapshot` must return a stable value or React will
  // re-render forever.
  let cache: T | null | undefined;

  const read = (): T | null => {
    try {
      const raw = window.localStorage.getItem(storageKey);
      return raw !== null && isValid(raw) ? raw : null;
    } catch {
      // Private browsing and blocked-storage settings throw on access.
      return null;
    }
  };

  const notify = () => {
    for (const listener of listeners) listener();
  };

  const onStorageEvent = (event: StorageEvent) => {
    if (event.key !== null && event.key !== storageKey) return;
    cache = read();
    notify();
  };

  return {
    subscribe(listener) {
      if (listeners.size === 0 && typeof window !== "undefined") {
        window.addEventListener("storage", onStorageEvent);
      }
      listeners.add(listener);

      return () => {
        listeners.delete(listener);
        if (listeners.size === 0 && typeof window !== "undefined") {
          window.removeEventListener("storage", onStorageEvent);
        }
      };
    },

    get() {
      if (cache === undefined) cache = read();
      return cache;
    },

    set(value) {
      if (cache === value) return;
      cache = value;
      try {
        if (value === null) window.localStorage.removeItem(storageKey);
        else window.localStorage.setItem(storageKey, value);
      } catch {
        // The value simply will not persist; the current session still works.
      }
      notify();
    },
  };
}
