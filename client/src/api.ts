export interface GamStatus {
  installed: boolean;
  gamPath: string | null;
  version: string | null;
  oauthReady: boolean;
  configured: boolean;
  mock: boolean;
}

export interface AppState {
  adminEmail: string | null;
  completedSteps: string[];
  setupDone: boolean;
}

export interface SetupStatus {
  gam: GamStatus;
  state: AppState;
  installCmd: string;
}

export interface WorkspaceUser {
  email: string;
  name: string;
  suspended: boolean;
  orgUnitPath: string;
}

export interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  parent: string;
  owner: string;
  modifiedTime: string;
  webViewLink: string;
  isFolder: boolean;
}

export interface Acl {
  permissionId: string;
  type: string;
  email: string;
  role: string;
  domain: string;
}

export interface JobSummary {
  id: string;
  kind: string;
  title: string;
  status: 'running' | 'succeeded' | 'failed' | 'cancelled';
  createdAt: number;
  finishedAt: number | null;
  progress: { done: number; total: number | null };
  artifact?: { filename: string } | null;
  logLines?: number;
  log?: { ts: number; stream: string; line: string }[];
}

/** Per-user Drive totals from /api/users/:email/stats. */
export interface UserStats {
  files: number;
  folders: number;
  totalSize: number;
  updatedAt: number;
  cached: boolean;
}

// ---- Mail (/api/mail/*) ----

export interface MailLabel {
  id: string;
  name: string;
  type: string;
  messagesTotal: number;
  messagesUnread: number;
}

export interface GmailProfile {
  email: string;
  messagesTotal: number;
  threadsTotal: number;
}

export interface MailMessage {
  id: string;
  threadId: string;
  date: string;
  from: string;
  to: string;
  subject: string;
  labels: string[];
  snippet: string;
  size: number;
  user: string;
}

export interface MailDetail extends MailMessage {
  cc: string;
  body: string;
}

export interface LargeMailBucket {
  label: string;
  count: number;
  bytes: number;
}

export interface LargeMailResult {
  minMb: number;
  count: number;
  totalBytes: number;
  buckets: LargeMailBucket[];
  messages: MailMessage[];
}

export interface StorageRow {
  email: string;
  reportDate: string;
  gmailMb: number;
  driveMb: number;
  totalMb: number;
}

/** Response of GET /api/mail/storage/report — per-user storage plus fetch metadata. */
export interface StorageReportResult {
  rows: StorageRow[];
  updatedAt: number;
  cached: boolean;
}

// ---- Dashboard (/api/dashboard/*) ----

/** Org-wide pooled storage (MB) from the customer usage report. */
export interface StoragePool {
  totalMb: number;
  usedMb: number;
  reportDate: string;
}

export interface DashboardSummary {
  pool: StoragePool;
  users: StorageRow[];
  updatedAt: number;
  cached: boolean;
}

export interface DirUsage {
  path: string;
  entries: number;
  bytes: number;
  oldest: number | null;
}

export interface ExportEntry {
  name: string;
  kind: 'zip' | 'jsonl' | 'csv' | 'folder' | 'other';
  bytes: number;
  mtime: number;
  mailbox: string | null;
  complete: boolean | null;
  format: string | null;
  includesAttachments: boolean | null;
  /** Its job is still listed under Jobs — not deletable here. */
  live: boolean;
}

export interface LocalStorageUsage {
  exports: { path: string; files: ExportEntry[] };
  jobLogs: DirUsage & { retentionDays: number };
}

// ---- URLs ----
// Every parameterized path is built here so each segment is encoded in exactly one place;
// call sites never touch encodeURIComponent. Fixed paths ('/api/users') stay literal.

const enc = encodeURIComponent;
const userBase = (email: string) => `/api/users/${enc(email)}`;
const fileBase = (owner: string, id: string) => `${userBase(owner)}/files/${enc(id)}`;
const mailBase = (email: string) => `/api/mail/${enc(email)}`;
const jobBase = (id: string) => `/api/jobs/${enc(id)}`;

/** Appends `refresh=1` — a manual reload asking the server to bypass its cache. */
export const withRefresh = (path: string, refresh: boolean): string =>
  refresh ? `${path}${path.includes('?') ? '&' : '?'}refresh=1` : path;

/** Server API paths that take a parameter. */
export const endpoints = {
  userStats: (email: string) => `${userBase(email)}/stats`,
  userFiles: (email: string) => `${userBase(email)}/files`,
  userFilesExport: (email: string) => `${userBase(email)}/files/export`,
  fileCopy: (owner: string, id: string) => `${fileBase(owner, id)}/copy`,
  fileMove: (owner: string, id: string) => `${fileBase(owner, id)}/move`,
  /** GET/POST/PATCH the file's sharing; with `who`, the DELETE target for one grantee. */
  fileAcls: (owner: string, id: string, who?: string) => `${fileBase(owner, id)}/acls${who ? `?who=${enc(who)}` : ''}`,
  mailLabels: (email: string) => `${mailBase(email)}/labels`,
  mailProfile: (email: string) => `${mailBase(email)}/profile`,
  mailMessages: (email: string, params: URLSearchParams) => `${mailBase(email)}/messages?${params}`,
  mailMessage: (email: string, id: string) => `${mailBase(email)}/messages/${enc(id)}`,
  mailLargeMail: (email: string, minMb: number | string) => `${mailBase(email)}/large-mail?minMb=${enc(minMb)}`,
  mailExport: (email: string) => `${mailBase(email)}/export`,
  job: (id: string) => jobBase(id),
  jobEvents: (id: string) => `${jobBase(id)}/events`,
  jobCancel: (id: string) => `${jobBase(id)}/cancel`,
  jobDownload: (id: string) => `${jobBase(id)}/download`,
  jobResults: (id: string) => `${jobBase(id)}/results.csv`,
};

/** In-app (client router) links that take a parameter. */
export const routes = {
  user: (email: string) => `/users/${enc(email)}`,
  mailbox: (email: string) => `/mail?user=${enc(email)}`,
};

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public body: unknown,
  ) {
    super(message);
  }
}

export async function api<T>(path: string, opts: RequestInit = {}): Promise<T> {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
  });
  const text = await res.text();
  let body: unknown;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  if (!res.ok) {
    const msg =
      body && typeof body === 'object' && 'error' in body ? String((body as { error: string }).error) : res.statusText;
    throw new ApiError(msg, res.status, body);
  }
  return body as T;
}

export const post = <T>(path: string, data: unknown): Promise<T> =>
  api<T>(path, { method: 'POST', body: JSON.stringify(data) });

export const patch = <T>(path: string, data: unknown): Promise<T> =>
  api<T>(path, { method: 'PATCH', body: JSON.stringify(data) });

export const del = <T>(path: string): Promise<T> => api<T>(path, { method: 'DELETE' });
