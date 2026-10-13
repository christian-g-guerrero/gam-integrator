import { Router } from 'express';
import { deleteExports, listExports } from '../exportFiles.js';
import { liveJobIds, LOG_DIR } from '../jobs.js';
import { EXPORT_DIR } from '../mailExport.js';
import { dirUsage, JOB_LOG_RETENTION_DAYS } from '../retention.js';
import { badRequest, h } from '../util.js';

/** What the app keeps on disk under dataDir(), and user-initiated deletion of mailbox exports. */
export const storageRouter = Router();

storageRouter.get(
  '/',
  h((_req, res) => {
    res.json({
      exports: { path: EXPORT_DIR, files: listExports(EXPORT_DIR, liveJobIds()) },
      jobLogs: { ...dirUsage(LOG_DIR), retentionDays: JOB_LOG_RETENTION_DAYS },
    });
  }),
);

/**
 * Delete the selected exports. Never automatic: an export may be the only copy of a deleted
 * account's mail. Unknown names and exports of jobs still in memory are ignored.
 */
storageRouter.post(
  '/exports/delete',
  h((req, res) => {
    const names = req.body?.names;
    if (!Array.isArray(names) || names.length === 0 || !names.every((n) => typeof n === 'string'))
      throw badRequest('names must be a non-empty array of export file names');
    res.json(deleteExports(EXPORT_DIR, names, liveJobIds()));
  }),
);
