import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { dataDir } from './gam/detect.js';

/** Per-user Drive totals, persisted so the Users table doesn't re-run GAM every visit. */
export interface UserStats {
  files: number;
  folders: number;
  totalSize: number;
  updatedAt: number;
}

const FILE = path.join(dataDir(), 'stats-cache.json');

type Cache = Record<string, UserStats>;

function load(): Cache {
  try {
    return JSON.parse(readFileSync(FILE, 'utf8'));
  } catch {
    return {};
  }
}

export function getCachedStats(email: string): UserStats | null {
  return load()[email] ?? null;
}

export function setCachedStats(email: string, stats: Omit<UserStats, 'updatedAt'>): UserStats {
  const cache = load();
  const entry = { ...stats, updatedAt: Date.now() };
  cache[email] = entry;
  mkdirSync(path.dirname(FILE), { recursive: true });
  writeFileSync(FILE, JSON.stringify(cache, null, 2));
  return entry;
}
