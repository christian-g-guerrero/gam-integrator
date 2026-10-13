/**
 * Module-level cache so a page's already-loaded data survives leaving and
 * re-entering its route. React Router unmounts the old route's component on
 * navigation, which would otherwise throw away fetched state and force a full
 * reload (spinners and all) every time the user switches tabs and comes back.
 *
 * In-memory only — cleared on a full page reload, and never shared with the
 * server-side disk caches, so mock and real sessions stay isolated.
 */
const store = new Map<string, unknown>();

export const getCached = <T>(key: string): T | undefined => store.get(key) as T | undefined;

export const setCached = <T>(key: string, value: T): void => {
  store.set(key, value);
};

/** Shared cache keys so call sites can't drift out of sync with a typo. */
export const CACHE_KEYS = {
  dashboard: 'dashboard',
  usersList: 'users:list',
  usersStats: 'users:stats',
  mailStorage: 'mail:storage',
} as const;
