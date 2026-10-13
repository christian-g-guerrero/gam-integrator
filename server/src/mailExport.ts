import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  createReadStream,
  createWriteStream,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
  type WriteStream,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'csv-parse/sync';
import PostalMime from 'postal-mime';
import { dataDir, isMock } from './gam/detect.js';
import { parseGamCsv } from './gam/csv.js';
import { csvArgs, GamError, runGamCsv, streamGam, type StreamHandle } from './gam/runner.js';
import {
  buildArchiveRecord,
  indexRowFromCsv,
  LABEL_DELIMITER,
  SCHEMA_VERSION,
  type ArchiveAttachment,
  type IndexRow,
} from './gam/mailArchive.js';
import { createJob, finishJob, jobLog, jobProgress, type Job } from './jobs.js';

/**
 * Full-mailbox export as a background job. Spec for the JSONL archive (schema,
 * manifest, guarantees): docs/mailbox-export-schema.md.
 *
 * JSONL pipeline — each message's raw RFC 822 source is the body of record:
 *   1. metadata pass  `print messages … showlabels showsize showsnippet showdate` → ids + Gmail-only fields
 *   2. raw pass       `export messages ids <chunk>` → Msg-<id>.eml, retried per missing id
 *   3. build          parse each .eml (postal-mime) → one v2 JSONL record; attachments → attachments/<id>/
 *   4. manifest.json  counts, failed ids, sha256 → everything ZIPped together
 *
 * CSV stays GAM's own spreadsheet-friendly output (one row per message via
 * `convertcrnl`); "+ attachments" reuses the raw pass for messages that have any.
 */

export const EXPORT_DIR = path.join(dataDir(), 'exports');
const MAX_ATTEMPTS = 3;
const RETRY_DELAY_MS = isMock() ? 500 : 20_000;
/** Message ids per `export messages ids …` invocation (argv stays small; a failure costs one chunk). */
const EML_CHUNK = 200;
/** Parallel GAM processes for the raw pass — well under Gmail's per-user quota. */
const EML_CONCURRENCY = 3;
const RE_MESSAGE_ID = /Message:\s*([A-Za-z0-9_-]{8,32})\b/;

export interface ExportOptions {
  email: string;
  format: 'csv' | 'jsonl';
  includeAttachments: boolean;
  includeSpamTrash: boolean;
}

class Cancelled extends Error {}

/** One cancellable handle over every GAM child the job has in flight. */
class HandleGroup implements StreamHandle {
  child = null;
  cancelled = false;
  private live = new Set<StreamHandle>();
  add(h: StreamHandle) {
    this.live.add(h);
    if (this.cancelled) h.cancel();
  }
  remove(h: StreamHandle) {
    this.live.delete(h);
  }
  cancel() {
    this.cancelled = true;
    for (const h of this.live) h.cancel();
  }
  check() {
    if (this.cancelled) throw new Cancelled();
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function startMailExport(opts: ExportOptions): Job {
  const { email, format, includeAttachments, includeSpamTrash } = opts;
  const zipped = format === 'jsonl' || includeAttachments;
  const job = createJob(
    'mail-export',
    `Export mailbox of ${email} (${format.toUpperCase()}${includeAttachments ? ' + attachments' : ', no attachment files'}${zipped ? ', ZIP' : ''}${includeSpamTrash ? ', incl. Spam/Trash' : ''})`,
    null,
  );
  const group = new HandleGroup();
  job.handle = group;
  void runExport(job, group, opts).catch((e) => {
    if (e instanceof Cancelled || group.cancelled) return finishJob(job, 'cancelled');
    jobLog(job, 'stderr', `Export failed: ${(e as Error).message}`);
    finishJob(job, 'failed');
  });
  return job;
}

async function runExport(job: Job, group: HandleGroup, opts: ExportOptions): Promise<void> {
  const { email, format, includeAttachments, includeSpamTrash } = opts;
  mkdirSync(EXPORT_DIR, { recursive: true });
  const stamp = new Date().toISOString().slice(0, 10);
  const safeEmail = email.replace(/[^a-z0-9@._-]/gi, '_');
  const jobDir = path.join(EXPORT_DIR, job.id);
  const emlDir = path.join(jobDir, '.eml');
  const query = includeSpamTrash ? 'in:anywhere' : null;
  const commands: string[][] = [];

  const run = (args: string[], onLine: (line: string, stream: 'stdout' | 'stderr') => void) => {
    commands.push(args);
    return runStream(group, args, onLine);
  };

  if (format === 'csv' && !includeAttachments) {
    const out = path.join(EXPORT_DIR, `${job.id}.csv`);
    const res = await csvPass(job, run, email, query, out);
    return finishFlat(job, res, out, `mailbox-${safeEmail}-${stamp}.csv`);
  }

  // ---- ZIP exports: JSONL (always) or CSV + attachments ----
  mkdirSync(jobDir, { recursive: true }); // staging for the ZIP — a flat CSV never needs one
  const labelIds = await labelIdMap(email);
  const profileTotal = await gmailMessagesTotal(email);
  const failedIds = new Set<string>();
  let listingComplete: boolean;
  let messageCount = 0;
  let attachmentCount = 0;
  let attachmentBytes = 0;
  const dataFile = format === 'jsonl' ? 'mailbox.jsonl' : 'mailbox.csv';
  const dataPath = path.join(jobDir, dataFile);
  const attachmentIndex: (ArchiveAttachment & { message_id: string })[] = [];

  let ids: string[];
  let index: Map<string, IndexRow> | null = null;
  if (format === 'jsonl') {
    const meta = await metadataPass(job, group, run, email, query);
    listingComplete = meta.complete;
    for (const id of meta.failedIds) failedIds.add(id);
    index = new Map(meta.rows.map((r) => [r.id, r]));
    ids = meta.rows.map((r) => r.id);
  } else {
    const res = await csvPass(job, run, email, query, dataPath);
    listingComplete = res.ok;
    messageCount = res.messages;
    ids = res.withAttachments;
    if (!res.ok && res.messages === 0) throw new Error(`GAM exited with code ${res.code}`);
  }
  group.check();

  // Raw pass — every message for JSONL; only messages with attachments for CSV.
  job.progress.total = ids.length;
  jobProgress(job, 0);
  jobLog(job, 'info', `Fetching raw source of ${ids.length} message(s)…`);
  const missing = await fetchEml(job, group, run, email, ids, emlDir);
  for (const id of missing) failedIds.add(id);

  // Build.
  const sink = includeAttachments
    ? {
        write(rel: string, bytes: Uint8Array) {
          const abs = path.join(jobDir, rel);
          mkdirSync(path.dirname(abs), { recursive: true });
          writeFileSync(abs, bytes);
        },
      }
    : undefined;
  const out: WriteStream | null = format === 'jsonl' ? createWriteStream(dataPath) : null;
  let built = 0;
  for (const id of ids) {
    group.check();
    const emlPath = path.join(emlDir, `Msg-${id}.eml`);
    let parsed = null;
    let failure: 'unavailable' | 'parse_error' | undefined;
    if (!existsSync(emlPath)) failure = 'unavailable';
    else {
      try {
        parsed = await PostalMime.parse(readFileSync(emlPath), { attachmentEncoding: 'arraybuffer' });
      } catch (e) {
        failure = 'parse_error';
        failedIds.add(id);
        jobLog(job, 'stderr', `Could not parse message ${id}: ${(e as Error).message}`);
      }
    }
    const rec = buildArchiveRecord({
      mailbox: email,
      index: index?.get(id) ?? {
        id,
        threadId: '',
        messageId: '',
        internalDate: '',
        labels: '',
        snippet: '',
        sizeEstimate: '',
      },
      labelIds,
      email: parsed,
      failure,
      attachmentSink: sink,
    });
    for (const a of rec.attachments) {
      attachmentCount += 1;
      attachmentBytes += a.size;
      if (format === 'csv') attachmentIndex.push({ message_id: id, ...a });
    }
    if (out && !out.write(JSON.stringify(rec) + '\n')) await new Promise<void>((r) => out.once('drain', () => r()));
    built += 1;
    if (built % 200 === 0) jobLog(job, 'info', `${built}/${ids.length} messages written…`);
  }
  if (out) await new Promise<void>((resolve, reject) => out.end((e?: Error | null) => (e ? reject(e) : resolve())));
  if (format === 'jsonl') messageCount = built;
  if (format === 'csv' && includeAttachments)
    writeAttachmentIndex(path.join(jobDir, 'attachments.csv'), attachmentIndex);
  rmSync(emlDir, { recursive: true, force: true });

  const complete = listingComplete && failedIds.size === 0;
  const manifest = {
    schema_version: SCHEMA_VERSION,
    complete,
    mailbox: email,
    exported_at: new Date().toISOString(),
    exporter: exporterInfo(),
    format,
    query: query ?? '',
    include_spam_trash: includeSpamTrash,
    include_attachments: includeAttachments,
    message_count: messageCount,
    gmail_messages_total: profileTotal,
    failed_ids: [...failedIds],
    attachment_count: attachmentCount,
    attachment_bytes: attachmentBytes,
    gam_commands: describeCommands(commands),
    files: [await fileEntry(jobDir, dataFile, format === 'jsonl' ? messageCount : null)],
  };
  writeFileSync(path.join(jobDir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  job.progress.total = messageCount;
  jobProgress(job, messageCount);

  const zipPath = path.join(EXPORT_DIR, `${job.id}.zip`);
  await zipDir(jobDir, zipPath);
  rmSync(jobDir, { recursive: true, force: true }); // the ZIP is the deliverable; don't keep attachments on disk twice
  const base = `mailbox-${safeEmail}-${stamp}`;
  job.artifact = { path: zipPath, filename: complete ? `${base}.zip` : `${base}-PARTIAL.zip` };
  if (complete) {
    jobLog(
      job,
      'info',
      `Export complete: ${messageCount} messages${includeAttachments ? `, ${attachmentCount} attachment files` : ''}. ZIP ready — use "Download".`,
    );
    finishJob(job, 'succeeded');
  } else {
    jobLog(
      job,
      'stderr',
      `INCOMPLETE export: ${failedIds.size} message(s) could not be fetched${listingComplete ? '' : ' and the message listing had errors'}. manifest.json records complete: false and the failed ids; the PARTIAL ZIP is still downloadable. Re-run the export for a complete one.`,
    );
    finishJob(job, 'failed');
  }
}

type Runner = (args: string[], onLine: (line: string, stream: 'stdout' | 'stderr') => void) => Promise<number>;

async function runStream(
  group: HandleGroup,
  args: string[],
  onLine: (line: string, stream: 'stdout' | 'stderr') => void,
): Promise<number> {
  group.check();
  const { handle, done } = await streamGam(args, onLine);
  group.add(handle);
  try {
    const code = await done;
    group.check();
    if (code === 130) throw new Cancelled();
    return code;
  } finally {
    group.remove(handle);
  }
}

/** Pass 1 (JSONL): ids + the Gmail-only fields (labels, internalDate, snippet, size). Retries transient per-message failures. */
async function metadataPass(job: Job, group: HandleGroup, run: Runner, email: string, query: string | null) {
  let lines: string[] = [];
  let failedIds = new Set<string>();
  let code = -1;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    if (attempt > 1) {
      jobLog(
        job,
        'info',
        `Gmail returned transient errors (${failedIds.size} messages failed) — retrying in ${RETRY_DELAY_MS / 1000}s (attempt ${attempt}/${MAX_ATTEMPTS})…`,
      );
      await sleep(RETRY_DELAY_MS);
      group.check();
    }
    lines = [];
    failedIds = new Set();
    code = await run(
      csvArgs([
        'user',
        email,
        'print',
        'messages',
        'max_to_print',
        '0',
        ...(query ? ['query', query] : []),
        'headers',
        'message-id',
        'showlabels',
        'delimiter',
        LABEL_DELIMITER,
        'showsize',
        'showsnippet',
        'showdate',
      ]),
      (line, stream) => {
        if (stream === 'stdout') {
          lines.push(line);
          if (lines.length % 200 === 0) jobProgress(job, lines.length - 1);
        } else if (line.trim()) {
          if (/Print Failed/i.test(line)) failedIds.add(line.match(RE_MESSAGE_ID)?.[1] ?? line);
          jobLog(job, 'info', line); // GAM progress ("Got N Messages…") arrives on stderr
        }
      },
    );
    if (!(code !== 0 && code !== 60 && failedIds.size > 0)) break;
  }
  const rows = parseGamCsv(lines.join('\n'))
    .map(indexRowFromCsv)
    .filter((r) => r.id);
  const empty = code === 60 || (code === 0 && rows.length === 0);
  if (code !== 0 && !empty && rows.length === 0)
    throw new GamError(`GAM exited with code ${code} while listing messages`);
  if (code !== 0 && !empty)
    jobLog(
      job,
      'stderr',
      `Message listing exited with code ${code} — ${failedIds.size} message(s) still failing after ${MAX_ATTEMPTS} attempts.`,
    );
  jobLog(job, 'info', empty ? 'Mailbox is empty.' : `Listed ${rows.length} messages.`);
  return { rows, failedIds, complete: code === 0 || empty };
}

/** Pass 2: raw RFC 822 source per id, in chunks, re-requesting whatever didn't land. Returns ids still missing. */
async function fetchEml(
  job: Job,
  group: HandleGroup,
  run: Runner,
  email: string,
  ids: string[],
  dir: string,
): Promise<string[]> {
  mkdirSync(dir, { recursive: true });
  const have = (id: string) => existsSync(path.join(dir, `Msg-${id}.eml`));
  let todo = ids.filter((id) => !have(id));
  let fetched = ids.length - todo.length;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS && todo.length; attempt++) {
    if (attempt > 1) {
      jobLog(
        job,
        'info',
        `${todo.length} message(s) failed to download — retrying in ${RETRY_DELAY_MS / 1000}s (attempt ${attempt}/${MAX_ATTEMPTS})…`,
      );
      await sleep(RETRY_DELAY_MS);
    }
    const chunks: string[][] = [];
    for (let i = 0; i < todo.length; i += EML_CHUNK) chunks.push(todo.slice(i, i + EML_CHUNK));
    const worker = async () => {
      for (let chunk = chunks.shift(); chunk; chunk = chunks.shift()) {
        await run(
          ['user', email, 'export', 'messages', 'ids', chunk.join(','), 'targetfolder', dir, 'overwrite', 'true'],
          (line, stream) => {
            if (stream === 'stdout' && /, Downloaded/.test(line)) {
              fetched += 1;
              if (fetched % 25 === 0) jobProgress(job, fetched);
            } else if (stream === 'stderr' && line.trim() && !/^(Getting|Got) /.test(line)) {
              jobLog(job, 'info', line);
            }
          },
        );
      }
    };
    await Promise.all(Array.from({ length: EML_CONCURRENCY }, worker));
    todo = todo.filter((id) => !have(id));
  }
  jobProgress(job, ids.length - todo.length);
  if (todo.length)
    jobLog(
      job,
      'stderr',
      `${todo.length} message(s) could not be downloaded after ${MAX_ATTEMPTS} attempts: ${todo.slice(0, 20).join(', ')}${todo.length > 20 ? ', …' : ''}`,
    );
  return todo;
}

interface CsvPassResult {
  ok: boolean;
  code: number;
  messages: number;
  withAttachments: string[];
}

/**
 * GAM's own CSV (spreadsheet format). `convertcrnl` keeps one row per line for
 * Excel/Sheets; with the escape char disabled (csvArgs) backslashes survive,
 * though a literal "\n" in a body is indistinguishable from a line break —
 * JSONL is the lossless format.
 */
async function csvPass(
  job: Job,
  run: Runner,
  email: string,
  query: string | null,
  outPath: string,
): Promise<CsvPassResult> {
  let res: CsvPassResult = { ok: false, code: -1, messages: 0, withAttachments: [] };
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    let failed = 0;
    if (attempt > 1) {
      jobLog(
        job,
        'info',
        `Gmail returned transient errors — retrying in ${RETRY_DELAY_MS / 1000}s (attempt ${attempt}/${MAX_ATTEMPTS})…`,
      );
      await sleep(RETRY_DELAY_MS);
    }
    const out = createWriteStream(outPath); // truncates on retry
    let header: string[] | null = null;
    let pending = '';
    let lines = 0;
    const withAttachments: string[] = [];
    const code = await run(
      csvArgs([
        'user',
        email,
        'print',
        'messages',
        'max_to_print',
        '0',
        ...(query ? ['query', query] : []),
        'headers',
        'date,from,to,cc,bcc,subject,message-id,in-reply-to,references,reply-to,delivered-to',
        'showlabels',
        'delimiter',
        '|',
        'showsize',
        'showsnippet',
        'showattachments',
        'showbody',
        'convertcrnl',
      ]),
      (line, stream) => {
        if (stream === 'stdout') {
          out.write(line + '\n');
          // Track which messages have attachments (for the "+ attachments" raw pass).
          pending = pending ? `${pending}\n${line}` : line;
          const row = parseCsvRecord(pending);
          if (row === null) return; // a quoted field spans lines — wait for the rest
          pending = '';
          lines += 1;
          if (header === null) header = row;
          else {
            const id = row[header.indexOf('id')];
            if (id && Number(row[header.indexOf('Attachments')]) > 0) withAttachments.push(id);
          }
          if (lines % 200 === 0) jobProgress(job, lines - 1);
        } else if (line.trim()) {
          if (/Print Failed/i.test(line)) failed += 1;
          jobLog(job, 'info', line);
        }
      },
    );
    await new Promise<void>((r) => out.end(() => r()));
    const empty = code === 60 || (code === 0 && lines === 0);
    res = { ok: code === 0 || empty, code, messages: Math.max(lines - 1, 0), withAttachments };
    if (!(code !== 0 && code !== 60 && failed > 0)) break;
  }
  return res;
}

/** One CSV record, or null while a quoted field is still open. */
function parseCsvRecord(text: string): string[] | null {
  try {
    return (parse(text, { relax_column_count: true }) as string[][])[0] ?? [];
  } catch {
    return null;
  }
}

function finishFlat(job: Job, res: CsvPassResult, filePath: string, filename: string) {
  jobProgress(job, res.messages);
  if (!res.ok) {
    jobLog(job, 'stderr', `GAM exited with code ${res.code}`);
    if (res.messages > 0) {
      job.artifact = { path: filePath, filename: filename.replace(/(\.[a-z]+)$/, '-PARTIAL$1') };
      jobLog(
        job,
        'stderr',
        `A PARTIAL export with ${res.messages} messages is still downloadable below. Re-run the export to try for a complete one.`,
      );
    }
    return finishJob(job, 'failed');
  }
  jobLog(job, 'info', res.messages ? `Message export complete: ${res.messages} messages.` : 'Mailbox is empty.');
  if (res.messages) job.artifact = { path: filePath, filename };
  finishJob(job, 'succeeded');
}

/** Label name → id, so records carry both (GAM's `showlabels` prints names). */
async function labelIdMap(email: string): Promise<Map<string, string>> {
  try {
    const rows = await runGamCsv(['user', email, 'print', 'labels']);
    return new Map(rows.filter((r) => r.id && r.name).map((r) => [r.name, r.id]));
  } catch {
    return new Map();
  }
}

/** Gmail profile messagesTotal (All Mail incl. Spam/Trash) — a reconciliation figure for the manifest. */
async function gmailMessagesTotal(email: string): Promise<number | null> {
  try {
    const rows = await runGamCsv(['user', email, 'print', 'gmailprofile']);
    const n = Number(rows[0]?.messagesTotal);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

function writeAttachmentIndex(file: string, rows: (ArchiveAttachment & { message_id: string })[]) {
  const cols = [
    'message_id',
    'attachment_id',
    'name',
    'mime_type',
    'size',
    'sha256',
    'inline',
    'content_id',
    'path',
  ] as const;
  const esc = (v: unknown) => {
    const s = v == null ? '' : String(v);
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  writeFileSync(file, [cols.join(','), ...rows.map((r) => cols.map((c) => esc(r[c])).join(','))].join('\n') + '\n');
}

async function fileEntry(dir: string, rel: string, lines: number | null) {
  const abs = path.join(dir, rel);
  const hash = createHash('sha256');
  await new Promise<void>((resolve, reject) =>
    createReadStream(abs)
      .on('data', (c) => hash.update(c))
      .on('end', () => resolve())
      .on('error', reject),
  );
  return { path: rel, bytes: statSync(abs).size, sha256: hash.digest('hex'), ...(lines === null ? {} : { lines }) };
}

/** The distinct GAM commands run (retries and per-chunk id lists collapsed) — provenance for the manifest. */
function describeCommands(commands: string[][]): string[] {
  const lines = commands.map((c) =>
    [
      'gam',
      ...c.map((a, i) =>
        c[i - 1] === 'ids'
          ? '<ids>'
          : c[i - 1] === 'targetfolder'
            ? '<staging dir>'
            : a === LABEL_DELIMITER
              ? '\\x1f'
              : a,
      ),
    ].join(' '),
  );
  return [...new Set(lines)];
}

let exporterCache: { name: string; version: string; commit: string | null } | null = null;
function exporterInfo() {
  if (exporterCache) return exporterCache;
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
  let version = '0.0.0';
  let commit: string | null = null;
  try {
    version = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')).version ?? version;
  } catch {
    /* unknown */
  }
  try {
    const head = readFileSync(path.join(root, '.git', 'HEAD'), 'utf8').trim();
    const ref = head.startsWith('ref: ') ? readFileSync(path.join(root, '.git', head.slice(5)), 'utf8').trim() : head;
    commit = ref.slice(0, 12) || null;
  } catch {
    /* not a git checkout (or packed ref) */
  }
  exporterCache = { name: 'gam-integrator', version, commit };
  return exporterCache;
}

function zipDir(dir: string, zipPath: string): Promise<void> {
  return new Promise((resolve, reject) =>
    execFile('/usr/bin/zip', ['-r', '-q', zipPath, '.'], { cwd: dir, maxBuffer: 16 * 1024 * 1024 }, (err) =>
      err ? reject(new Error(`Could not create ZIP: ${err.message}`)) : resolve(),
    ),
  );
}
