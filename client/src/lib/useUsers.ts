import { WorkspaceUser } from '../api';
import { CACHE_KEYS } from './pageCache';
import { useApi } from './useApi';

/**
 * The workspace users list. Every page and picker reads it through this one
 * hook so it's fetched once and then served from the module cache (users
 * rarely change mid-session; a full page reload refetches).
 */
export function useUsers() {
  return useApi<WorkspaceUser[]>('/api/users', { cacheKey: CACHE_KEYS.usersList });
}
