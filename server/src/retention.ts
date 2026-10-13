import { existsSync, readdirSync, rmSync, statSync } from 'node:fs';
import path from 'node:path';

/**
 * On-disk retention for what the app writes under dataDir() (exports, job logs).
 * Pure over a directory path so tests can point it at a temp dir — callers pass the
 * dataDir()-derived paths, which keeps mock and real data isolated.
 */

export const DAY_MS = 24 * 60 * 60 * 1000;
/** Job logs are diagnostics, not data — pruned automatically after this many days. */
export const JOB_LOG_RETENTION_DAYS = 30;

export interface DirUsage {
  path: string;
  entries: number;
  bytes: number;
  /** mtime (ms) of the oldest top-level entry, or null when empty. */
  oldest: number | null;
}

function entrySize(p: string): number {
  const st = statSync(p);
  if (!st.isDirectory()) return st.size;
  return readdirSync(p).reduce((sum, name) => sum + entrySize(path.join(p, name)), 0);
}

/** Top-level entries of `dir` (files or leftover job folders), with size and mtime. */
function entries(dir: string): { name: string; path: string; bytes: number; mtime: number }[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((name) => {
    const p = path.join(dir, name);
    try {
      return [{ name, path: p, bytes: entrySize(p), mtime: statSync(p).mtimeMs }];
    } catch {
      return []; // vanished mid-scan
    }
  });
}

export function dirUsage(dir: string): DirUsage {
  const list = entries(dir);
  return {
    path: dir,
    entries: list.length,
    bytes: list.reduce((s, e) => s + e.bytes, 0),
    oldest: list.length ? Math.min(...list.map((e) => e.mtime)) : null,
  };
}

/**
 * Delete top-level entries of `dir` last modified more than `olderThanDays` ago
 * (0 = everything). `protect(name)` keeps an entry regardless — e.g. a job still in memory.
 */
export function pruneDir(
  dir: string,
  opts: { olderThanDays: number; now?: number; protect?: (name: string) => boolean },
): { deleted: number; bytes: number } {
  const cutoff = (opts.now ?? Date.now()) - opts.olderThanDays * DAY_MS;
  let deleted = 0;
  let bytes = 0;
  for (const e of entries(dir)) {
    if (opts.olderThanDays > 0 && e.mtime > cutoff) continue;
    if (opts.protect?.(e.name)) continue;
    rmSync(e.path, { recursive: true, force: true });
    deleted += 1;
    bytes += e.bytes;
  }
  return { deleted, bytes };
}
