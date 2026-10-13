import { createHash } from 'node:crypto';
import { addressParser, type Address as PostalAddress, type Email } from 'postal-mime';
import { parseDateIso, stripQuotedHistory } from './mailFormat.js';

/**
 * Mailbox archive (JSONL) record format — schema v2. Built from each message's
 * raw RFC 822 source (GAM `export messages`) plus Gmail metadata GAM can only
 * give via `print messages` (labels, internalDate, snippet, size). Spec:
 * docs/mailbox-export-schema.md. Bump SCHEMA_VERSION on any breaking change.
 */
export const SCHEMA_VERSION = 2;

/** Separator GAM joins label names with (`print messages … delimiter`) — a control char no label name contains. */
export const LABEL_DELIMITER = '\x1f';

export interface ArchiveAddress {
  name: string;
  email: string;
}

export interface ArchiveLabel {
  id: string;
  name: string;
}

export interface ArchiveAttachment {
  /** Stable within the message (MIME order) — Gmail's own attachmentId changes on every API call, so it can't be a key. */
  attachment_id: string;
  name: string | null;
  mime_type: string;
  size: number;
  sha256: string;
  inline: boolean;
  content_id: string | null;
  /** Relative path inside the export ZIP, or null when attachment binaries weren't exported. */
  path: string | null;
}

export type BodyStatus = 'ok' | 'empty' | 'unavailable' | 'parse_error';

export interface ArchiveRecord {
  schema_version: number;
  mailbox: string;
  id: string;
  thread_id: string;
  internal_date: string | null;
  date: string | null;
  date_iso: string | null;
  message_id: string | null;
  in_reply_to: string | null;
  references: string[];
  from: ArchiveAddress[];
  sender: ArchiveAddress[];
  to: ArchiveAddress[];
  cc: ArchiveAddress[];
  bcc: ArchiveAddress[];
  reply_to: ArchiveAddress[];
  delivered_to: string[];
  headers_raw: Record<string, string>;
  subject: string | null;
  snippet: string | null;
  labels: ArchiveLabel[];
  size_estimate: number | null;
  body_status: BodyStatus;
  body_text: string | null;
  body_html: string | null;
  body_text_stripped: string | null;
  attachments: ArchiveAttachment[];
}

/** One row of the metadata pass (`print messages headers message-id showlabels showsize showsnippet showdate`). */
export interface IndexRow {
  id: string;
  threadId: string;
  messageId: string;
  /** With `date` not among the requested `headers`, GAM's `Date` column is the message's internalDate (receive time). */
  internalDate: string;
  labels: string;
  snippet: string;
  sizeEstimate: string;
}

export function indexRowFromCsv(r: Record<string, string>): IndexRow {
  return {
    id: r.id ?? '',
    threadId: r.threadId ?? '',
    messageId: r['Message-ID'] ?? '',
    internalDate: r.Date ?? '',
    labels: r.Labels ?? '',
    snippet: r.Snippet ?? '',
    sizeEstimate: r.SizeEstimate ?? '',
  };
}

/** GAM prints label *names* (or the raw id when unknown); map back to {id,name} via the mailbox's label list. */
export function resolveLabels(joined: string, idByName: Map<string, string>): ArchiveLabel[] {
  if (!joined) return [];
  return joined
    .split(LABEL_DELIMITER)
    .filter(Boolean)
    .map((name) => ({ id: idByName.get(name) ?? name, name }));
}

/** Flattens RFC 5322 groups ("Team: a@x, b@y;") into their members and drops entries without a usable address (e.g. `undisclosed-recipients:;`). */
export function normalizeAddresses(list: PostalAddress | PostalAddress[] | undefined): ArchiveAddress[] {
  if (!list) return [];
  const flat = (Array.isArray(list) ? list : [list]).flatMap((a) => (a.group ? a.group : [a]));
  return flat
    .filter((a) => typeof a.address === 'string' && /^[^\s@<>]+@[^\s@<>]+$/.test(a.address.trim()))
    .map((a) => ({ name: (a.name ?? '').trim(), email: a.address!.trim() }));
}

/** Header names kept verbatim (still RFC 2047-encoded, folding removed) in `headers_raw`. */
const RAW_HEADERS = [
  'from',
  'sender',
  'to',
  'cc',
  'bcc',
  'reply-to',
  'delivered-to',
  'subject',
  'date',
  'message-id',
  'in-reply-to',
  'references',
];
const ADDRESS_LIST_HEADERS = new Set(['to', 'cc', 'bcc', 'reply-to', 'delivered-to']);

/** Raw header values by lower-cased name. Repeated list headers (e.g. two Delivered-To) are comma-joined; other repeats keep the first. */
export function rawHeaders(email: Email): Record<string, string> {
  const out: Record<string, string> = {};
  for (const { key, line } of email.headerLines) {
    if (!RAW_HEADERS.includes(key)) continue;
    const value = line
      .slice(line.indexOf(':') + 1)
      .replace(/\r?\n(?=[ \t])/g, '')
      .trim();
    if (out[key] === undefined) out[key] = value;
    else if (ADDRESS_LIST_HEADERS.has(key)) out[key] += `, ${value}`;
  }
  return out;
}

function msgIds(value: string | undefined): string[] {
  return value?.match(/<[^<>\s]+>/g) ?? [];
}

const HTML_DOC_RE = /^\s*(<!DOCTYPE\s+html|<html[\s>])/i;

function safeName(name: string): string {
  const cleaned = name
    // eslint-disable-next-line no-control-regex -- control chars are invalid in filenames; replacing them is the point
    .replace(/[\\/:*?"<>|\x00-\x1f]/g, '_')
    .replace(/^\.+/, '_')
    .trim();
  return (cleaned || 'unnamed').slice(0, 150);
}

function contentBytes(content: ArrayBuffer | Uint8Array | string): Uint8Array {
  if (typeof content === 'string') return new TextEncoder().encode(content);
  return content instanceof Uint8Array ? content : new Uint8Array(content);
}

export interface AttachmentSink {
  /** Persist an attachment's bytes at `relPath` (relative to the export root). */
  write(relPath: string, bytes: Uint8Array): void;
}

export interface BuildInput {
  mailbox: string;
  index: IndexRow;
  labelIds: Map<string, string>;
  /** Parsed raw message, or null when it couldn't be fetched / parsed. */
  email: Email | null;
  failure?: 'unavailable' | 'parse_error';
  /** When set, attachment binaries are written under attachments/<id>/ and linked by `path`. */
  attachmentSink?: AttachmentSink;
}

/** Assemble one v2 record. Bodies are never synthesized: absent text or HTML is `null`, with `body_status` saying why. */
export function buildArchiveRecord({
  mailbox,
  index,
  labelIds,
  email,
  failure,
  attachmentSink,
}: BuildInput): ArchiveRecord {
  const size = Number(index.sizeEstimate);
  const base = {
    schema_version: SCHEMA_VERSION,
    mailbox,
    id: index.id,
    thread_id: index.threadId,
    internal_date: parseDateIso(index.internalDate),
    snippet: index.snippet || null,
    labels: resolveLabels(index.labels, labelIds),
    size_estimate: index.sizeEstimate && Number.isFinite(size) ? size : null,
  };
  if (!email) {
    return {
      ...base,
      date: null,
      date_iso: null,
      message_id: msgIds(index.messageId)[0] ?? null,
      in_reply_to: null,
      references: [],
      from: [],
      sender: [],
      to: [],
      cc: [],
      bcc: [],
      reply_to: [],
      delivered_to: [],
      headers_raw: {},
      subject: null,
      body_status: failure ?? 'unavailable',
      body_text: null,
      body_html: null,
      body_text_stripped: null,
      attachments: [],
    };
  }

  const headers = rawHeaders(email);
  let text = email.text ?? null;
  let html = email.html ?? null;
  // Some senders put a whole HTML document in text/plain — keep HTML out of body_text.
  if (text && HTML_DOC_RE.test(text)) {
    if (!html) html = text;
    text = null;
  }

  const attachments = email.attachments.map((a, i): ArchiveAttachment => {
    const bytes = contentBytes(a.content);
    const attachmentId = `att-${i + 1}`;
    let relPath: string | null = null;
    if (attachmentSink) {
      relPath = `attachments/${index.id}/${attachmentId}-${safeName(a.filename ?? 'unnamed')}`;
      attachmentSink.write(relPath, bytes);
    }
    return {
      attachment_id: attachmentId,
      name: a.filename ?? null,
      mime_type: a.mimeType,
      size: bytes.byteLength,
      sha256: createHash('sha256').update(bytes).digest('hex'),
      inline: a.disposition === 'inline' || Boolean(a.related),
      content_id: a.contentId ?? null,
      path: relPath,
    };
  });

  return {
    ...base,
    date: headers.date ?? null,
    date_iso: headers.date ? parseDateIso(headers.date) : null,
    message_id: msgIds(email.messageId)[0] ?? msgIds(index.messageId)[0] ?? (email.messageId?.trim() || null),
    in_reply_to: msgIds(email.inReplyTo)[0] ?? null,
    references: msgIds(email.references),
    from: normalizeAddresses(email.from),
    sender: normalizeAddresses(email.sender),
    to: normalizeAddresses(email.to),
    cc: normalizeAddresses(email.cc),
    bcc: normalizeAddresses(email.bcc),
    reply_to: normalizeAddresses(email.replyTo),
    delivered_to: normalizeAddresses(headers['delivered-to'] ? addressParser(headers['delivered-to']) : undefined).map(
      (a) => a.email,
    ),
    headers_raw: headers,
    subject: email.subject ?? null,
    body_status: text || html ? 'ok' : 'empty',
    body_text: text,
    body_html: html,
    // Derived for convenience (RAG/search); computed on LF-normalized text so CRLF bodies match the quote patterns.
    body_text_stripped: text ? stripQuotedHistory(text.replace(/\r\n?/g, '\n')) : null,
    attachments,
  };
}
