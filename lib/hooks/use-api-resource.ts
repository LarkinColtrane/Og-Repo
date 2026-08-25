"use client";

import { useCallback, useEffect, useState } from "react";
import type { ApiMeta, ApiResponse } from "@/types";
import { ApiRequestError } from "@/lib/api/client";

export type ResourceStatus = "idle" | "loading" | "success" | "error";

export interface ApiResource<T> {
  data: T | null;
  meta: ApiMeta | null;
  status: ResourceStatus;
  error: string | null;
  /** True only for the first load; a filter change keeps the old data visible. */
  isInitialLoading: boolean;
  /** True while re-fetching with data already on screen. */
  isRefreshing: boolean;
  reload: () => void;
}

/**
 * Fetches an API resource and tracks its loading, error and empty states.
 *
 * Three decisions worth understanding:
 *
 *  - **`fetcher` must be memoised.** Wrap it in `useCallback` with the same
 *    dependencies that go into `key`. It is an effect dependency, so an inline
 *    arrow function would be a new value every render and re-fetch forever.
 *  - **`key === null` means "nothing to fetch".** The idle state is *derived* from
 *    the key rather than assigned inside the effect, so there is no render pass
 *    with a stale status to correct.
 *  - **Previous data stays on screen during a re-fetch.** Blanking a chart on every
 *    filter change makes the UI feel broken; a subtle refreshing state reads better
 *    than a flash of empty space.
 */
export function useApiResource<T>(
  key: string | null,
  fetcher: (signal: AbortSignal) => Promise<ApiResponse<T>>,
): ApiResource<T> {
  const [data, setData] = useState<T | null>(null);
  const [meta, setMeta] = useState<ApiMeta | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  // What the last settled request was for, and how it went. "Loading" is not
  // stored: it is whenever the request we want differs from the one that settled.
  const [settled, setSettled] = useState<{
    requestId: string | null;
    status: "success" | "error";
    error: string | null;
  }>({ requestId: null, status: "success", error: null });

  const requestId = key === null ? null : `${key}|${reloadToken}`;

  useEffect(() => {
    if (requestId === null) return;

    const controller = new AbortController();
    let cancelled = false;

    fetcher(controller.signal)
      .then((response) => {
        if (cancelled) return;
        setData(response.data);
        setMeta(response.meta);
        setSettled({ requestId, status: "success", error: null });
      })
      .catch((caught: unknown) => {
        if (cancelled) return;
        // An aborted request is a filter change overtaking an in-flight fetch, not
        // a failure worth showing anyone.
        if (caught instanceof DOMException && caught.name === "AbortError") return;
        setSettled({
          requestId,
          status: "error",
          error:
            caught instanceof ApiRequestError
              ? caught.message
              : "Something went wrong loading this data.",
        });
      });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [requestId, fetcher]);

  const reload = useCallback(() => setReloadToken((token) => token + 1), []);

  const hasData = data !== null;
  const status: ResourceStatus =
    requestId === null
      ? "idle"
      : settled.requestId !== requestId
        ? "loading"
        : settled.status;

  return {
    data,
    meta,
    status,
    error: status === "error" ? settled.error : null,
    isInitialLoading: status === "loading" && !hasData,
    isRefreshing: status === "loading" && hasData,
    reload,
  };
}
