import { Router } from 'express';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { dataDir } from '../gam/detect.js';
import { GamError, runGamCsv } from '../gam/runner.js';
import { fetchStorageRows } from '../gam/storage.js';
import { listDomainUsers } from '../gam/users.js';
import { LABEL_DELIMITER } from '../gam/mailArchive.js';
import { jobView } from '../jobs.js';
import { startMailExport } from '../mailExport.js';
import { h, requireEmail, badRequest } from '../util.js';

export const mailRouter = Router();

const MB = 1024 * 1024;

// ---- Per-user Gmail/Drive storage (Admin Reports API — one call for all users) ----

const STORAGE_CACHE = path.join(dataDir(), 'mail-storage-cache.json');

/**
 * Storage usage for every user. Reports lag ~2 days behind real time; the
 * result is cached on disk until an explicit ?refresh=1.
 */
mailRouter.get(
  '/storage/report',
  h(async (req, res) => {
    if (req.query.refresh !== '1') {
      try {
        const cached = JSON.parse(readFileSync(STORAGE_CACHE, 'utf8'));
        if (Array.isArray(cached.rows)) return res.json({ ...cached, cached: true });
      } catch {
        /* no cache yet */
      }
    }
    const payload = { rows: await fetchStorageRows(), updatedAt: Date.now() };
    mkdirSync(path.dirname(STORAGE_CACHE), { recursive: true });
    writeFileSync(STORAGE_CACHE, JSON.stringify(payload));
    res.json({ ...payload, cached: false });
  }),
);

// ---- Full-mailbox export (background job; pipeline + format spec in ../mailExport.ts) ----

mailRouter.post(
  '/:email/export',
  h(async (req, res) => {
    const job = startMailExport({
      email: requireEmail(req.params.email),
      format: req.body?.format === 'csv' ? 'csv' : 'jsonl',
      includeAttachments: Boolean(req.body?.includeAttachments),
      // Gmail excludes Spam/Trash from an unscoped query by default (same as the
      // search bar) — opt in explicitly with `in:anywhere` for a true full export.
      includeSpamTrash: Boolean(req.body?.includeSpamTrash),
    });
    res.json({ jobId: job.id, job: jobView(job) });
  }),
);

/** GAM exits 60 ("no entities found") when a mailbox/query has no matches. */
async function runGamCsvAllowEmpty(args: string[]): Promise<Record<string, string>[]> {
  try {
    return await runGamCsv(args);
  } catch (e) {
    if (e instanceof GamError && (e.code === 60 || /Got 0 /.test(e.stderr))) return [];
    throw e;
  }
}

const MSG_ID_RE = /^[A-Za-z0-9_-]{8,32}$/;

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

function normalizeMessage(r: Record<string, string>, user: string): MailMessage {
  return {
    id: r.id ?? '',
    threadId: r.threadId ?? '',
    date: r.Date ?? r.date ?? '',
    from: r.From ?? r.from ?? '',
    to: r.To ?? r.to ?? '',
    subject: r.Subject ?? r.subject ?? '(no subject)',
    labels: (r.Labels ?? '').split(LABEL_DELIMITER).filter(Boolean),
    snippet: r.Snippet ?? r.snippet ?? '',
    size: Number(r.SizeEstimate ?? 0),
    user,
  };
}

const LIST_HEADERS = [
  'headers',
  'date,from,to,subject',
  'showlabels',
  'delimiter',
  LABEL_DELIMITER,
  'showsnippet',
  'showsize',
];

/**
 * Gmail profile — the mailbox's true total message/thread count ("All Mail",
 * including Spam and Trash). Labels can't provide this: the Gmail API has no
 * "All Mail" label, so the audit page reconciles label counts against this.
 */
mailRouter.get(
  '/:email/profile',
  h(async (req, res) => {
    const email = requireEmail(req.params.email);
    const rows = await runGamCsv(['user', email, 'print', 'gmailprofile']);
    const r = rows[0] ?? {};
    res.json({
      email: r.emailAddress ?? email,
      messagesTotal: Number(r.messagesTotal ?? 0),
      threadsTotal: Number(r.threadsTotal ?? 0),
    });
  }),
);

/** Labels (folders) of a mailbox, with message counts. */
mailRouter.get(
  '/:email/labels',
  h(async (req, res) => {
    const email = requireEmail(req.params.email);
    const rows = await runGamCsvAllowEmpty(['user', email, 'print', 'labels', 'showcounts']);
    res.json(
      rows
        .map((r) => ({
          id: r.id ?? '',
          name: r.name ?? '',
          type: r.type ?? 'user',
          messagesTotal: Number(r.messagesTotal ?? 0),
          messagesUnread: Number(r.messagesUnread ?? 0),
        }))
        .filter((l) => l.id),
    );
  }),
);

/** Messages in a mailbox, filtered by label and/or Gmail query. */
mailRouter.get(
  '/:email/messages',
  h(async (req, res) => {
    const email = requireEmail(req.params.email);
    const labelId = req.query.labelId ? String(req.query.labelId) : null;
    const q = req.query.q ? String(req.query.q) : null;
    const max = Math.min(Number(req.query.max) || 50, 500);
    if (labelId && !/^[A-Za-z0-9_ -]+$/.test(labelId)) throw badRequest(`Invalid label id: ${labelId}`);
    const args = ['user', email, 'print', 'messages'];
    if (q) args.push('query', q);
    if (labelId) args.push('labelids', labelId);
    args.push('max_to_print', String(max), ...LIST_HEADERS);
    const rows = await runGamCsvAllowEmpty(args);
    res.json(rows.map((r) => normalizeMessage(r, email)).filter((m) => m.id));
  }),
);

const SIZE_BUCKET_EDGES_MB = [1, 5, 10, 25, 50, 100, 250, 500, 1000];

/**
 * Every message at or above a size threshold, with an exact count/total and
 * a size-bucket breakdown. Unlike `/messages`, this paginates through the
 * *entire* result set (GAM `max_to_print 0`) instead of stopping at a fixed
 * page — the size filter itself keeps the match set small enough that a
 * full scan stays fast even on multi-GB mailboxes.
 */
mailRouter.get(
  '/:email/large-mail',
  h(async (req, res) => {
    const email = requireEmail(req.params.email);
    const minMb = Math.min(Math.max(Number(req.query.minMb) || 5, 1), 1000);
    const rows = await runGamCsvAllowEmpty([
      'user',
      email,
      'print',
      'messages',
      'query',
      `larger:${minMb}M`,
      'max_to_print',
      '0',
      ...LIST_HEADERS,
    ]);
    const messages = rows
      .map((r) => normalizeMessage(r, email))
      .filter((m) => m.id)
      .sort((a, b) => b.size - a.size);
    const totalBytes = messages.reduce((s, m) => s + m.size, 0);
    const edges = SIZE_BUCKET_EDGES_MB.filter((mb) => mb >= minMb);
    if (edges[0] !== minMb) edges.unshift(minMb);
    const buckets = edges.map((lo, i) => {
      const hi = edges[i + 1] ?? null;
      const inBucket = messages.filter((m) => m.size >= lo * MB && (hi === null || m.size < hi * MB));
      return {
        label: hi === null ? `${lo}+ MB` : `${lo}–${hi} MB`,
        count: inBucket.length,
        bytes: inBucket.reduce((s, m) => s + m.size, 0),
      };
    });
    res.json({ minMb, count: messages.length, totalBytes, buckets, messages });
  }),
);

/** One message with its full body. */
mailRouter.get(
  '/:email/messages/:id',
  h(async (req, res) => {
    const email = requireEmail(req.params.email);
    const id = String(req.params.id);
    if (!MSG_ID_RE.test(id)) throw badRequest(`Invalid message id: ${id}`);
    const rows = await runGamCsvAllowEmpty([
      'user',
      email,
      'print',
      'messages',
      'ids',
      id,
      'headers',
      'date,from,to,cc,subject',
      'showlabels',
      'delimiter',
      LABEL_DELIMITER,
      'showbody',
    ]);
    if (rows.length === 0) return res.status(404).json({ error: `Message ${id} not found in ${email}'s mailbox.` });
    const r = rows[0];
    res.json({ ...normalizeMessage(r, email), cc: r.Cc ?? r.cc ?? '', body: r.Body ?? '' });
  }),
);

/** Domain-wide search: run the Gmail query against every user's mailbox. */
mailRouter.post(
  '/search',
  h(async (req, res) => {
    const q = String(req.body?.q ?? '').trim();
    if (!q) throw badRequest('Enter a Gmail search query.');
    const maxPerUser = Math.min(Number(req.body?.maxPerUser) || 10, 100);
    const users = await listDomainUsers();
    const results: MailMessage[] = [];
    const errors: string[] = [];
    const queue = [...users];
    const worker = async () => {
      for (let u = queue.shift(); u; u = queue.shift()) {
        try {
          const rows = await runGamCsvAllowEmpty([
            'user',
            u.email,
            'print',
            'messages',
            'query',
            q,
            'max_to_print',
            String(maxPerUser),
            ...LIST_HEADERS,
          ]);
          results.push(...rows.map((r) => normalizeMessage(r, u.email)).filter((m) => m.id));
        } catch (e) {
          errors.push(`${u.email}: ${(e as Error).message.split('\n')[0]}`);
        }
      }
    };
    await Promise.all(Array.from({ length: 4 }, worker));
    results.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    res.json({ results, scannedUsers: users.length, errors });
  }),
);
