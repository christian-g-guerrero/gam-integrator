import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync, existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { DAY_MS, dirUsage, pruneDir } from './retention.js';

const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })));

const NOW = Date.UTC(2026, 9, 8);
function fixture() {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'retention-test-'));
  dirs.push(dir);
  const put = (name: string, ageDays: number, bytes = 10, folder = false) => {
    const p = path.join(dir, name);
    if (folder) {
      mkdirSync(p);
      writeFileSync(path.join(p, 'inner.eml'), 'x'.repeat(bytes));
    } else writeFileSync(p, 'x'.repeat(bytes));
    const t = (NOW - ageDays * DAY_MS) / 1000;
    utimesSync(p, t, t);
  };
  put('old.zip', 40, 100);
  put('new.zip', 2, 50);
  put('leftover', 60, 30, true);
  put('live-job.zip', 90, 5);
  return dir;
}

describe('retention', () => {
  it('dirUsage sums files and folders recursively', () => {
    const u = dirUsage(fixture());
    expect(u.entries).toBe(4);
    expect(u.bytes).toBe(185);
    expect(u.oldest).toBe(NOW - 90 * DAY_MS);
  });

  it('pruneDir deletes only entries older than the cutoff, skipping protected ones', () => {
    const dir = fixture();
    const r = pruneDir(dir, { olderThanDays: 30, now: NOW, protect: (n) => n.startsWith('live-job') });
    expect(r).toEqual({ deleted: 2, bytes: 130 });
    expect(existsSync(path.join(dir, 'new.zip'))).toBe(true);
    expect(existsSync(path.join(dir, 'live-job.zip'))).toBe(true);
    expect(existsSync(path.join(dir, 'leftover'))).toBe(false);
  });

  it('olderThanDays 0 deletes everything unprotected', () => {
    const dir = fixture();
    expect(pruneDir(dir, { olderThanDays: 0, now: NOW, protect: (n) => n === 'live-job.zip' }).deleted).toBe(3);
  });

  it('a missing directory is empty, not an error', () => {
    expect(dirUsage('/nonexistent/gam-retention').entries).toBe(0);
    expect(pruneDir('/nonexistent/gam-retention', { olderThanDays: 0 }).deleted).toBe(0);
  });
});
