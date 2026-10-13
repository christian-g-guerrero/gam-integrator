import { runGamCsv } from './runner.js';

/** Per-user Gmail/Drive/total storage usage (MB) from the Admin Reports API. */
export interface StorageRow {
  email: string;
  reportDate: string;
  gmailMb: number;
  driveMb: number;
  totalMb: number;
}

/**
 * Storage usage for every user — one Reports API call covers the whole domain.
 * Reports lag ~2 days behind real time. Shared by the Email-audit storage
 * report and the Dashboard so they parse the same command identically.
 */
export async function fetchStorageRows(): Promise<StorageRow[]> {
  const rows = await runGamCsv([
    'report',
    'users',
    'parameters',
    'accounts:gmail_used_quota_in_mb,accounts:drive_used_quota_in_mb,accounts:used_quota_in_mb',
  ]);
  return rows
    .map((r) => ({
      email: r.email ?? '',
      reportDate: r.date ?? '',
      gmailMb: Number(r['accounts:gmail_used_quota_in_mb'] ?? 0),
      driveMb: Number(r['accounts:drive_used_quota_in_mb'] ?? 0),
      totalMb: Number(r['accounts:used_quota_in_mb'] ?? 0),
    }))
    .filter((r) => r.email);
}
