import { Router } from 'express';
import { listUserFiles, userFilesCsvRaw } from '../gam/drive.js';
import { runGam, runGamCsv } from '../gam/runner.js';
import { getCachedStats, setCachedStats } from '../statsCache.js';
import { h, requireEmail, requireFileId, badRequest } from '../util.js';

export const filesRouter = Router();

/** Full flat file list for a user; the client handles folder navigation. */
filesRouter.get(
  '/:email/files',
  h(async (req, res) => {
    const email = requireEmail(req.params.email);
    res.json(await listUserFiles(email));
  }),
);

/**
 * Totals for the Users table: how many files/folders a user owns and their
 * combined size. Served from a persistent cache unless ?refresh=1 — computing
 * these means a full GAM filelist per user.
 */
filesRouter.get(
  '/:email/stats',
  h(async (req, res) => {
    const email = requireEmail(req.params.email);
    if (req.query.refresh !== '1') {
      const cached = getCachedStats(email);
      if (cached) return res.json({ ...cached, cached: true });
    }
    const files = await listUserFiles(email);
    const owned = files.filter((f) => f.owner === email);
    const stats = setCachedStats(email, {
      files: owned.filter((f) => !f.isFolder).length,
      folders: owned.filter((f) => f.isFolder).length,
      totalSize: owned.reduce((s, f) => s + f.size, 0),
    });
    res.json({ ...stats, cached: false });
  }),
);

/** Raw GAM CSV as a download. */
filesRouter.get(
  '/:email/files/export',
  h(async (req, res) => {
    const email = requireEmail(req.params.email);
    const csv = await userFilesCsvRaw(email);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="filelist-${email.replace(/[^a-z0-9@._-]/gi, '_')}.csv"`,
    );
    res.send(csv);
  }),
);

// ---- Sharing / ACLs ----

const ROLES = ['reader', 'commenter', 'writer', 'fileOrganizer', 'organizer'];

function pickAcl(row: Record<string, string>, suffix: string): string {
  const key = Object.keys(row).find((k) => k.toLowerCase().endsWith(suffix.toLowerCase()));
  return key ? row[key] : '';
}

filesRouter.get(
  '/:email/files/:fileId/acls',
  h(async (req, res) => {
    const email = requireEmail(req.params.email);
    const fileId = requireFileId(req.params.fileId);
    const rows = await runGamCsv(['user', email, 'print', 'drivefileacls', fileId]);
    res.json(
      rows.map((r) => ({
        permissionId: pickAcl(r, 'permission.id'),
        type: pickAcl(r, 'permission.type'),
        email: pickAcl(r, 'permission.emailAddress'),
        role: pickAcl(r, 'permission.role'),
        domain: pickAcl(r, 'permission.domain'),
      })),
    );
  }),
);

filesRouter.post(
  '/:email/files/:fileId/acls',
  h(async (req, res) => {
    const email = requireEmail(req.params.email);
    const fileId = requireFileId(req.params.fileId);
    const shareWith = requireEmail(req.body?.shareWith, 'shareWith');
    const role = String(req.body?.role ?? 'reader');
    if (!ROLES.includes(role)) throw badRequest(`Invalid role: ${role}`);
    const out = await runGam(['user', email, 'add', 'drivefileacl', fileId, 'user', shareWith, 'role', role]);
    res.json({ ok: true, output: out });
  }),
);

filesRouter.patch(
  '/:email/files/:fileId/acls',
  h(async (req, res) => {
    const email = requireEmail(req.params.email);
    const fileId = requireFileId(req.params.fileId);
    const who = requireEmail(req.body?.who, 'who');
    const role = String(req.body?.role ?? '');
    if (!ROLES.includes(role)) throw badRequest(`Invalid role: ${role}`);
    const out = await runGam(['user', email, 'update', 'drivefileacl', fileId, who, 'role', role]);
    res.json({ ok: true, output: out });
  }),
);

filesRouter.delete(
  '/:email/files/:fileId/acls',
  h(async (req, res) => {
    const email = requireEmail(req.params.email);
    const fileId = requireFileId(req.params.fileId);
    const who = requireEmail(req.query?.who, 'who');
    const out = await runGam(['user', email, 'delete', 'drivefileacl', fileId, who]);
    res.json({ ok: true, output: out });
  }),
);

// ---- Copy / Move ----

filesRouter.post(
  '/:email/files/:fileId/copy',
  h(async (req, res) => {
    const email = requireEmail(req.params.email);
    const fileId = requireFileId(req.params.fileId);
    const args = ['user', email, 'copy', 'drivefile', fileId];
    if (req.body?.newName) args.push('newfilename', String(req.body.newName));
    if (req.body?.targetParentId) args.push('parentid', requireFileId(req.body.targetParentId, 'target folder id'));
    const out = await runGam(args);
    res.json({ ok: true, output: out });
  }),
);

filesRouter.post(
  '/:email/files/:fileId/move',
  h(async (req, res) => {
    const email = requireEmail(req.params.email);
    const fileId = requireFileId(req.params.fileId);
    const targetParentId =
      req.body?.targetParentId === 'root' ? 'root' : requireFileId(req.body?.targetParentId, 'target folder id');
    const out = await runGam(['user', email, 'update', 'drivefile', fileId, 'parentid', targetParentId]);
    res.json({ ok: true, output: out });
  }),
);
