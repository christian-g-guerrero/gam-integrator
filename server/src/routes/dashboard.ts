import { Router } from 'express';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { dataDir } from '../gam/detect.js';
import { runGamCsv } from '../gam/runner.js';
import { fetchStorageRows } from '../gam/storage.js';
import { h } from '../util.js';

export const dashboardRouter = Router();

const CACHE = path.join(dataDir(), 'dashboard-cache.json');

/** Org-wide pooled storage (MB) from the customer usage report. */
interface StoragePool {
  totalMb: number;
  usedMb: number;
  reportDate: string;
}

/**
 * The customer report comes back long-format (columns: date,name,value) with
 * one row per parameter — unlike the per-user report's wide layout.
 */
async function fetchPool(): Promise<StoragePool> {
  const rows = await runGamCsv([
    'report',
    'customer',
    'parameters',
    'accounts:total_quota_in_mb,accounts:used_quota_in_mb',
  ]);
  const pick = (name: string) => Number(rows.find((r) => r.name === name)?.value ?? 0);
  return {
    totalMb: pick('accounts:total_quota_in_mb'),
    usedMb: pick('accounts:used_quota_in_mb'),
    reportDate: rows[0]?.date ?? '',
  };
}

/**
 * Everything the Dashboard needs in one cached payload: the org's pooled-storage
 * total/used plus per-user Gmail/Drive/total usage. Both come from the Admin
 * Reports API (they lag ~2 days). Cached on disk until an explicit ?refresh=1.
 */
dashboardRouter.get(
  '/summary',
  h(async (req, res) => {
    if (req.query.refresh !== '1') {
      try {
        const cached = JSON.parse(readFileSync(CACHE, 'utf8'));
        if (cached.pool && Array.isArray(cached.users)) return res.json({ ...cached, cached: true });
      } catch {
        /* no cache yet */
      }
    }
    const [pool, users] = await Promise.all([fetchPool(), fetchStorageRows()]);
    const payload = { pool, users, updatedAt: Date.now() };
    mkdirSync(path.dirname(CACHE), { recursive: true });
    writeFileSync(CACHE, JSON.stringify(payload));
    res.json({ ...payload, cached: false });
  }),
);
