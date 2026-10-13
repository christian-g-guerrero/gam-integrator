import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { getCached, setCached } from './pageCache';

export interface UseApiResult<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
  /** Re-fetch; pass true to request server-side refresh (?refresh=1). */
  reload: (refresh?: boolean) => void;
}

/**
 * Standard page loader: fetch-on-mount, stale-response-safe, optional
 * module-cache seeding so route re-entry restores instantly (no loader
 * flash — see pageCache.ts). `path` may be a function so callers can
 * append ?refresh=1 on manual reloads.
 */
export function useApi<T>(
  path: string | ((refresh: boolean) => string),
  opts?: { cacheKey?: string; enabled?: boolean },
): UseApiResult<T> {
  const cacheKey = opts?.cacheKey;
  const enabled = opts?.enabled ?? true;

  // Seed from the module cache so switching back to a page that already
  // loaded is instant — no loader flash and no refetch.
  const [data, setData] = useState<T | null>(() => (cacheKey ? (getCached<T>(cacheKey) ?? null) : null));
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // `path` is read through a ref (rather than as an effect/callback
  // dependency) because callers commonly pass a fresh arrow function every
  // render — depending on it directly would refetch on every render.
  const pathRef = useRef(path);
  pathRef.current = path;

  // Monotonically increasing id: a response is only applied if it's still
  // the most recently issued request when it resolves. This discards a
  // response from a request superseded by a newer reload() (including a
  // reload fired while one is already in flight) and, since the hook's refs
  // outlive nothing past unmount, an unmounted instance simply stops caring
  // once nothing reads `data`/`error` again.
  const requestId = useRef(0);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const load = useCallback(
    (refresh: boolean) => {
      const id = ++requestId.current;
      const p = pathRef.current;
      const url = typeof p === 'function' ? p(refresh) : p;
      setLoading(true);
      api<T>(url).then(
        (d) => {
          if (!mounted.current || id !== requestId.current) return;
          setData(d);
          if (cacheKey) setCached(cacheKey, d);
          setError(null);
          setLoading(false);
        },
        (e) => {
          if (!mounted.current || id !== requestId.current) return;
          setError(e.message);
          setLoading(false);
        },
      );
    },
    [cacheKey],
  );

  // Fetch on mount unless we were seeded from the cache — but only once per
  // mount; toggling `enabled` back on later (e.g. a tab becoming active)
  // should not refetch data that already loaded.
  const fetchedOnMount = useRef(data !== null);
  useEffect(() => {
    if (!enabled || fetchedOnMount.current) return;
    fetchedOnMount.current = true;
    load(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);

  const reload = useCallback((refresh = false) => load(refresh), [load]);

  return { data, error, loading, reload };
}
