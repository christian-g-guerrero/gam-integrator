import { GamError, runGamCsv, runGamCsvRaw } from './runner.js';

/** Normalized Drive file as served to the frontend. */
export interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  parent: string; // '' = My Drive root
  owner: string;
  modifiedTime: string;
  webViewLink: string;
  isFolder: boolean;
}

export const FOLDER_MIME = 'application/vnd.google-apps.folder';

const FILELIST_ARGS = (email: string) => [
  'user',
  email,
  'print',
  'filelist',
  'fields',
  'id,name,mimetype,size,parents,modifiedtime,webviewlink,owners.emailaddress',
];

function pick(row: Record<string, string>, ...keys: string[]): string {
  for (const k of keys) {
    if (row[k] !== undefined && row[k] !== '') return row[k];
  }
  // GAM flattens nested fields with dotted/indexed headers whose exact shape
  // varies by version — fall back to a suffix match.
  for (const k of keys) {
    const found = Object.keys(row).find((h) => h.toLowerCase().endsWith(k.toLowerCase()));
    if (found && row[found] !== '') return row[found];
  }
  return '';
}

export function normalizeFileRow(row: Record<string, string>, email: string): DriveFile {
  const mimeType = pick(row, 'mimeType', 'mimetype');
  const parent = pick(row, 'parents.0.id', 'parents');
  return {
    id: pick(row, 'id'),
    name: pick(row, 'name', 'title'),
    mimeType,
    size: Number(pick(row, 'size')) || 0,
    parent: /^\d+$/.test(parent) ? '' : parent, // "parents" may be a count column in some GAM versions
    owner: pick(row, 'owners.0.emailAddress', 'Owner') || email,
    modifiedTime: pick(row, 'modifiedTime', 'modifiedtime'),
    webViewLink: pick(row, 'webViewLink', 'webviewlink'),
    isFolder: mimeType === FOLDER_MIME,
  };
}

export async function listUserFiles(email: string): Promise<DriveFile[]> {
  let rows: Record<string, string>[];
  try {
    rows = await runGamCsv(FILELIST_ARGS(email));
  } catch (e) {
    // GAM exits 60 ("no entities found") for users who own zero files.
    if (e instanceof GamError && (e.code === 60 || /Got 0 Drive Files/.test(e.stderr))) return [];
    throw e;
  }
  return rows.map((r) => normalizeFileRow(r, email)).filter((f) => f.id);
}

export async function userFilesCsvRaw(email: string): Promise<string> {
  return runGamCsvRaw(FILELIST_ARGS(email));
}

/** Subtree walk over a flat file list: `fileId` plus every descendant. */
export function subtreeFrom(all: DriveFile[], fileId: string): DriveFile[] {
  const target = all.find((f) => f.id === fileId);
  if (!target) return [];
  if (!target.isFolder) return [target];
  const byParent = new Map<string, DriveFile[]>();
  for (const f of all) {
    const list = byParent.get(f.parent) ?? [];
    list.push(f);
    byParent.set(f.parent, list);
  }
  const seen = new Set<string>();
  const result: DriveFile[] = [];
  const walk = (folder: DriveFile) => {
    if (seen.has(folder.id)) return;
    seen.add(folder.id);
    result.push(folder);
    for (const child of byParent.get(folder.id) ?? []) {
      if (child.isFolder) walk(child);
      else if (!seen.has(child.id)) {
        seen.add(child.id);
        result.push(child);
      }
    }
  };
  walk(target);
  return result;
}

/**
 * All files affected by transferring `fileId`, as seen from ONE user's Drive.
 * Note: GAM filelists contain only files the user owns, so items owned by
 * others inside the folder are invisible here — use the deep index for those.
 */
export async function collectSubtree(email: string, fileId: string): Promise<DriveFile[]> {
  return subtreeFrom(await listUserFiles(email), fileId);
}

let deepCache: { at: number; files: DriveFile[]; users: number; errors: string[] } | null = null;
const DEEP_TTL_MS = 5 * 60 * 1000;

/** Drop the cached deep index — call after anything that changes ownership. */
export function invalidateDeepIndex(): void {
  deepCache = null;
}

/**
 * Org-wide file index: the merged owned-files lists of every user. Each file
 * has exactly one in-domain owner, so the union covers everything transferable
 * — including items no single user (even the admin) can see in one query.
 * Cached briefly so preview + start don't re-scan the whole domain twice.
 */
export async function buildDeepIndex(
  emails: string[],
): Promise<{ files: DriveFile[]; users: number; errors: string[] }> {
  if (deepCache && Date.now() - deepCache.at < DEEP_TTL_MS) {
    return { files: deepCache.files, users: deepCache.users, errors: deepCache.errors };
  }
  const merged = new Map<string, DriveFile>();
  const errors: string[] = [];
  const queue = [...emails];
  const worker = async () => {
    for (let e = queue.shift(); e; e = queue.shift()) {
      try {
        for (const f of await listUserFiles(e)) {
          if (!merged.has(f.id)) merged.set(f.id, f);
        }
      } catch (err) {
        errors.push(`${e}: ${(err as Error).message.split('\n')[0]}`);
      }
    }
  };
  await Promise.all(Array.from({ length: 4 }, worker));
  deepCache = { at: Date.now(), files: [...merged.values()], users: emails.length, errors };
  return { files: deepCache.files, users: emails.length, errors };
}
