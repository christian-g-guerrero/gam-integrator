/** Shared display formatters. */

export function fmtSize(n: number): string {
  if (!n) return '—';
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(2)} GB`;
}

/** Full date + time (invalid input echoes back as-is). */
export function fmtDate(d: string | number): string {
  const t = new Date(d);
  return isNaN(t.getTime()) ? String(d) : t.toLocaleString();
}

/** Date only — for columns like "Modified" where time is noise. */
export function fmtDay(d: string | number): string {
  const t = new Date(d);
  return isNaN(t.getTime()) ? '—' : t.toLocaleDateString();
}

const MIME_LABELS: Record<string, string> = {
  'application/vnd.google-apps.folder': 'Folder',
  'application/vnd.google-apps.document': 'Doc',
  'application/vnd.google-apps.spreadsheet': 'Sheet',
  'application/vnd.google-apps.presentation': 'Slides',
  'application/vnd.google-apps.form': 'Form',
  'application/pdf': 'PDF',
};

export function mimeLabel(m: string): string {
  return MIME_LABELS[m] ?? (m.split('/').pop() ?? m).slice(0, 12);
}

/** Time of day only — for log lines within one job. */
export function fmtTime(d: string | number): string {
  const t = new Date(d);
  return isNaN(t.getTime()) ? String(d) : t.toLocaleTimeString();
}

/** "1 export" / "3 exports" — pass `many` for irregular plurals ("mailbox" → "mailboxes"). */
export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n.toLocaleString()} ${n === 1 ? one : many}`;
}
