/* eslint-disable @typescript-eslint/no-explicit-any -- this validator walks arbitrary parsed JSON; every field is type-checked at runtime */
/**
 * Structural check of a mailbox-export ZIP against the v2 contract (docs/mailbox-export-schema.md).
 *
 *   npm run verify-export -w server -- <export.zip>
 *
 * Prints counts and failing Gmail ids only — never subjects, addresses or bodies — so it can run on a real
 * export without the output leaking mail content. Exits 1 if any check fails.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RECORD_KEYS = [
  'schema_version',
  'mailbox',
  'id',
  'thread_id',
  'internal_date',
  'date',
  'date_iso',
  'message_id',
  'in_reply_to',
  'references',
  'from',
  'sender',
  'to',
  'cc',
  'bcc',
  'reply_to',
  'delivered_to',
  'headers_raw',
  'subject',
  'snippet',
  'labels',
  'size_estimate',
  'body_status',
  'body_text',
  'body_html',
  'body_text_stripped',
  'attachments',
];
const ADDRESS_KEYS = ['from', 'sender', 'to', 'cc', 'bcc', 'reply_to'];
const BODY_STATUSES = ['ok', 'empty', 'unavailable', 'parse_error'];
const ISO_RE = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(\.\d+)?Z$/;
const MSGID_RE = /^<[^<>\s]+>$/;

export interface VerifyReport {
  ok: boolean;
  /** Check name → number of records (or files) failing it. */
  failures: Record<string, number>;
  /** Check name → up to 5 example Gmail ids. */
  examples: Record<string, string[]>;
  stats: Record<string, number | string | boolean | null>;
}

const sha256 = (buf: Buffer) => createHash('sha256').update(buf).digest('hex');

/** Verify an already-unzipped export directory. */
export function verifyExportDir(dir: string): VerifyReport {
  const failures: Record<string, number> = {};
  const examples: Record<string, string[]> = {};
  const fail = (check: string, id = '') => {
    failures[check] = (failures[check] ?? 0) + 1;
    const ex = (examples[check] ??= []);
    if (id && ex.length < 5) ex.push(id);
  };

  const manifestPath = path.join(dir, 'manifest.json');
  if (!existsSync(manifestPath)) {
    fail('manifest.json missing');
    return { ok: false, failures, examples, stats: {} };
  }
  const m = JSON.parse(readFileSync(manifestPath, 'utf8'));
  for (const k of [
    'schema_version',
    'complete',
    'mailbox',
    'exported_at',
    'exporter',
    'format',
    'query',
    'include_spam_trash',
    'include_attachments',
    'message_count',
    'gmail_messages_total',
    'failed_ids',
    'attachment_count',
    'attachment_bytes',
    'gam_commands',
    'files',
  ]) {
    if (!(k in m)) fail(`manifest: missing ${k}`);
  }
  if (m.format !== 'jsonl') fail('manifest: format is not jsonl (CSV exports are not checked)');

  const dataPath = path.join(dir, 'mailbox.jsonl');
  const raw = existsSync(dataPath) ? readFileSync(dataPath) : null;
  if (!raw) {
    fail('mailbox.jsonl missing');
    return { ok: false, failures, examples, stats: {} };
  }
  const file = (m.files ?? []).find((f: { path: string }) => f.path === 'mailbox.jsonl');
  if (!file) fail('manifest: files[] has no mailbox.jsonl entry');
  else {
    if (file.bytes !== raw.length) fail('manifest: mailbox.jsonl byte count mismatch');
    if (file.sha256 !== sha256(raw)) fail('manifest: mailbox.jsonl sha256 mismatch');
  }

  const lines = raw
    .toString('utf8')
    .split('\n')
    .filter((l) => l.length > 0);
  if (file && file.lines !== lines.length) fail('manifest: files[].lines != JSONL line count');
  if (m.message_count !== lines.length) fail('manifest: message_count != JSONL line count');

  const ids = new Set<string>();
  const messageIds = new Map<string, number>();
  const statusCounts: Record<string, number> = {};
  let attachments = 0;
  let attachmentBytes = 0;
  let withText = 0;
  let withHtml = 0;
  // Legitimately possible (drafts, malformed senders) — reported, not failed.
  let noMessageId = 0;
  let emptyFrom = 0;

  lines.forEach((line, n) => {
    let r: Record<string, any>;
    try {
      r = JSON.parse(line);
    } catch {
      fail('record: not valid JSON', `line ${n + 1}`);
      return;
    }
    const id = typeof r.id === 'string' ? r.id : `line ${n + 1}`;
    for (const k of RECORD_KEYS) if (!(k in r)) fail(`record: missing ${k}`, id);
    if (r.schema_version !== 2) fail('record: schema_version != 2', id);
    if (r.mailbox !== m.mailbox) fail('record: mailbox != manifest mailbox', id);
    if (ids.has(id)) fail('record: duplicate Gmail id', id);
    ids.add(id);
    if (!r.thread_id) fail('record: empty thread_id', id);

    if (r.internal_date !== null && !ISO_RE.test(r.internal_date)) fail('record: internal_date not ISO', id);
    if (r.date_iso !== null && !ISO_RE.test(r.date_iso)) fail('record: date_iso not ISO', id);
    if (r.date !== null && r.date_iso === null) fail('record: Date header present but date_iso null', id);

    if (r.message_id === null) noMessageId++;
    else if (!MSGID_RE.test(r.message_id)) fail('record: message_id not <…> form', id);
    else messageIds.set(r.message_id, (messageIds.get(r.message_id) ?? 0) + 1);
    if (r.in_reply_to !== null && !MSGID_RE.test(r.in_reply_to)) fail('record: in_reply_to not <…> form', id);
    if (!Array.isArray(r.references) || r.references.some((x: unknown) => typeof x !== 'string' || !MSGID_RE.test(x)))
      fail('record: references malformed', id);

    for (const k of ADDRESS_KEYS) {
      const v = r[k];
      if (
        !Array.isArray(v) ||
        v.some((a) => !a || typeof a.email !== 'string' || !a.email.includes('@') || !('name' in a))
      )
        fail(`record: ${k} malformed`, id);
    }
    if (Array.isArray(r.from) && r.from.length === 0) emptyFrom++;
    if (!Array.isArray(r.delivered_to)) fail('record: delivered_to not an array', id);
    if (!r.headers_raw || typeof r.headers_raw !== 'object') fail('record: headers_raw not an object', id);

    if (!Array.isArray(r.labels) || r.labels.some((l: any) => typeof l?.id !== 'string' || typeof l?.name !== 'string'))
      fail('record: labels malformed', id);
    else if (r.labels.some((l: any) => /^Label_/.test(l.name)))
      fail('record: user label name unresolved (Label_…)', id);
    if (r.size_estimate !== null && !Number.isFinite(r.size_estimate)) fail('record: size_estimate not a number', id);
    if (typeof r.snippet === 'string' && /&(#\d+|amp|lt|gt|quot);/.test(r.snippet))
      fail('record: snippet still HTML-escaped', id);

    if (!BODY_STATUSES.includes(r.body_status)) fail('record: body_status not in enum', id);
    statusCounts[r.body_status] = (statusCounts[r.body_status] ?? 0) + 1;
    const hasBody = r.body_text !== null || r.body_html !== null;
    if (r.body_status === 'ok' && !hasBody) fail('record: body_status ok but no body', id);
    if (r.body_status !== 'ok' && hasBody) fail('record: body present but body_status not ok', id);
    if (r.body_status === 'unavailable' && !(m.failed_ids ?? []).includes(id))
      fail('record: unavailable but not in manifest failed_ids', id);
    if (typeof r.body_text === 'string' && /^\s*<(!doctype|html)[\s>]/i.test(r.body_text))
      fail('record: body_text looks like HTML', id);
    if (r.body_text !== null) withText++;
    if (r.body_html !== null) withHtml++;
    if (r.body_text === null && r.body_text_stripped !== null) fail('record: body_text_stripped without body_text', id);

    if (!Array.isArray(r.attachments)) fail('record: attachments not an array', id);
    else
      r.attachments.forEach((a: any, i: number) => {
        attachments++;
        attachmentBytes += Number(a?.size) || 0;
        if (a?.attachment_id !== `att-${i + 1}`) fail('attachment: attachment_id not att-<n> in order', id);
        for (const k of ['name', 'mime_type', 'size', 'sha256', 'inline', 'content_id', 'path'])
          if (!(k in (a ?? {}))) fail(`attachment: missing ${k}`, id);
        if (m.include_attachments) {
          if (!a?.path) fail('attachment: path null in an attachments export', id);
          else {
            const abs = path.join(dir, a.path);
            if (!existsSync(abs)) fail('attachment: file missing from ZIP', id);
            else {
              const buf = readFileSync(abs);
              if (buf.length !== a.size) fail('attachment: size mismatch', id);
              if (sha256(buf) !== a.sha256) fail('attachment: sha256 mismatch', id);
            }
          }
        } else if (a?.path !== null) fail('attachment: path set in a no-attachments export', id);
      });
  });

  if (m.attachment_count !== attachments) fail('manifest: attachment_count != sum of records');
  if (m.attachment_bytes !== attachmentBytes) fail('manifest: attachment_bytes != sum of records');
  const failedCount = (m.failed_ids ?? []).length;
  if (m.complete !== (failedCount === 0)) fail('manifest: complete disagrees with failed_ids');

  const duplicateMessageIds = [...messageIds.values()].filter((c) => c > 1).length;
  const stats = {
    mailbox: m.mailbox,
    complete: m.complete,
    include_spam_trash: m.include_spam_trash,
    include_attachments: m.include_attachments,
    records: lines.length,
    gmail_messages_total: m.gmail_messages_total,
    failed_ids: failedCount,
    ...Object.fromEntries(Object.entries(statusCounts).map(([k, v]) => [`body_status.${k}`, v])),
    with_body_text: withText,
    with_body_html: withHtml,
    attachments,
    attachment_bytes: attachmentBytes,
    // Same message in several labels/threads is one record; duplicates here are legitimately possible
    // (e.g. a message sent to yourself) — informational, not a failure.
    duplicate_message_ids: duplicateMessageIds,
    null_message_id: noMessageId,
    empty_from: emptyFrom,
    exporter_version: m.exporter?.version ?? null,
    exporter_commit: m.exporter?.commit ?? null,
  };
  return { ok: Object.keys(failures).length === 0, failures, examples, stats };
}

/** Unzip to a temp dir, verify, clean up. */
export function verifyExportZip(zipPath: string): VerifyReport {
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'gam-verify-'));
  try {
    execFileSync('unzip', ['-q', zipPath, '-d', tmp]);
    return verifyExportDir(tmp);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const target = process.argv[2];
  if (!target || !existsSync(target)) {
    console.error('usage: verify-export <export.zip | unzipped export dir>');
    process.exit(2);
  }
  const report = statSync(target).isDirectory() ? verifyExportDir(target) : verifyExportZip(target);
  console.log(JSON.stringify(report, null, 2));
  console.log(report.ok ? 'PASS — export matches the v2 contract' : 'FAIL — see failures above');
  process.exit(report.ok ? 0 : 1);
}
