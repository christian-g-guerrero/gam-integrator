import { execFileSync } from 'node:child_process';
import { closeSync, existsSync, openSync, readdirSync, readSync, rmSync, statSync } from 'node:fs';
import path from 'node:path';

/**
 * The mailbox-export registry behind Settings → Local data: one row per top-level entry of the
 * exports dir, labelled with the mailbox it holds (read from the file itself — job state is gone
 * after a restart). Callers pass the dataDir()-derived dir, keeping mock and real apart.
 */

export type ExportKind = 'zip' | 'jsonl' | 'csv' | 'folder' | 'other';

export interface ExportEntry {
  name: string;
  kind: ExportKind;
  bytes: number;
  mtime: number;
  /** The exported mailbox, when the file says (null for leftovers / unreadable files). */
  mailbox: string | null;
  /** From manifest.json (v2 ZIPs); null when there's no manifest to say. */
  complete: boolean | null;
  /** Data format inside a ZIP ('jsonl' | 'csv') per its manifest; null when unknown. */
  format: string | null;
  includesAttachments: boolean | null;
  /** Belongs to a job still in memory (downloadable from Jobs) — never deletable here. */
  live: boolean;
}

/** `<jobId>.zip|.jsonl|.csv` or a leftover `<jobId>/` folder → the job id. */
export const exportJobId = (name: string) => name.replace(/\.(zip|jsonl|csv)$/, '');

function size(p: string): number {
  const st = statSync(p);
  return st.isDirectory() ? readdirSync(p).reduce((s, n) => s + size(path.join(p, n)), 0) : st.size;
}

/** First `max` bytes of a file as text (enough for a CSV header row or most first JSONL records). */
function head(p: string, max = 256 * 1024): string {
  const fd = openSync(p, 'r');
  try {
    const buf = Buffer.alloc(max);
    return buf.subarray(0, readSync(fd, buf, 0, max, 0)).toString('utf8');
  } finally {
    closeSync(fd);
  }
}

function manifestOf(
  zip: string,
): { mailbox?: string; complete?: boolean; format?: string; include_attachments?: boolean } | null {
  try {
    // argv array, no shell. -p streams one member to stdout.
    return JSON.parse(
      execFileSync('/usr/bin/unzip', ['-p', zip, 'manifest.json'], { maxBuffer: 4 * 1024 * 1024 }).toString('utf8'),
    );
  } catch {
    return null; // no manifest (older CSV ZIPs) or unreadable
  }
}

function firstJsonlMailbox(p: string): string | null {
  const line = head(p).split('\n')[0];
  try {
    const rec = JSON.parse(line);
    return typeof rec.mailbox === 'string' ? rec.mailbox : typeof rec.user === 'string' ? rec.user : null;
  } catch {
    return null; // first record longer than the read window, or not JSON
  }
}

function firstCsvMailbox(p: string): string | null {
  const [header, row] = head(p, 64 * 1024).split(/\r?\n/);
  if (!header || !row) return null;
  const col = header.split(',').findIndex((h) => /^"?user"?$/i.test(h.trim()));
  if (col < 0) return null;
  const v = row.split(',')[col]?.replace(/^"|"$/g, '').trim();
  return v && v.includes('@') ? v : null;
}

export function listExports(dir: string, liveIds: Set<string>): ExportEntry[] {
  if (!existsSync(dir)) return [];
  const out: ExportEntry[] = [];
  for (const name of readdirSync(dir)) {
    if (name.startsWith('.')) continue; // .DS_Store etc.
    const p = path.join(dir, name);
    try {
      const st = statSync(p);
      const kind: ExportKind = st.isDirectory()
        ? 'folder'
        : ((/\.(zip|jsonl|csv)$/.exec(name)?.[1] as ExportKind) ?? 'other');
      let mailbox: string | null = null;
      let complete: boolean | null = null;
      let format: string | null = kind === 'jsonl' || kind === 'csv' ? kind : null;
      let includesAttachments: boolean | null = kind === 'jsonl' || kind === 'csv' ? false : null;
      if (kind === 'zip') {
        const m = manifestOf(p);
        mailbox = m?.mailbox ?? null;
        complete = typeof m?.complete === 'boolean' ? m.complete : null;
        format = m?.format ?? null;
        includesAttachments = typeof m?.include_attachments === 'boolean' ? m.include_attachments : null;
      } else if (kind === 'jsonl') mailbox = firstJsonlMailbox(p);
      else if (kind === 'csv') mailbox = firstCsvMailbox(p);
      out.push({
        name,
        kind,
        bytes: size(p),
        mtime: st.mtimeMs,
        mailbox,
        complete,
        format,
        includesAttachments,
        live: liveIds.has(exportJobId(name)),
      });
    } catch {
      /* vanished mid-scan */
    }
  }
  return out.sort((a, b) => b.mtime - a.mtime);
}

/**
 * Delete the named entries. Only exact names from the current listing are honoured (no paths,
 * no traversal), and live entries are skipped. Returns what was actually removed.
 */
export function deleteExports(
  dir: string,
  names: string[],
  liveIds: Set<string>,
): { deleted: string[]; bytes: number } {
  const present = new Map(listExports(dir, liveIds).map((e) => [e.name, e]));
  const deleted: string[] = [];
  let bytes = 0;
  for (const name of new Set(names)) {
    const e = present.get(name);
    if (!e || e.live) continue;
    rmSync(path.join(dir, e.name), { recursive: true, force: true });
    deleted.push(e.name);
    bytes += e.bytes;
  }
  return { deleted, bytes };
}
