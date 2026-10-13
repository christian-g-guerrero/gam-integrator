import { Router } from 'express';
import { buildDeepIndex, invalidateDeepIndex, listUserFiles, subtreeFrom, DriveFile } from '../gam/drive.js';
import { planTransfer } from '../gam/transferPlan.js';
import { listDomainUsers } from '../gam/users.js';
import { runGam, streamGam, StreamHandle } from '../gam/runner.js';
import { createJob, finishJob, getJob, jobLog, jobProgress, jobView, Job } from '../jobs.js';
import { h, requireEmail, requireFileId, badRequest } from '../util.js';

export const transferRouter = Router();

function requireFileIds(body: Record<string, unknown> | undefined): string[] {
  const raw = Array.isArray(body?.fileIds) ? body!.fileIds : [body?.fileId];
  const ids = raw.map((v) => requireFileId(v));
  if (ids.length === 0) throw badRequest('No files selected.');
  return [...new Set(ids)];
}

/**
 * Enumerate the union of the transfer subtrees. Quick mode sees only files the
 * source user owns; deep mode merges every domain user's owned files first, so
 * items owned by others (even ones nobody shared with the admin) are found too.
 */
async function enumerateSubtrees(
  sourceUser: string,
  fileIds: string[],
  deep: boolean,
): Promise<{ affected: DriveFile[]; index: DriveFile[]; scannedUsers: number; scanErrors: string[] }> {
  let index: DriveFile[];
  let scannedUsers = 1;
  let scanErrors: string[] = [];
  if (deep) {
    const users = await listDomainUsers();
    const res = await buildDeepIndex(users.map((u) => u.email));
    index = res.files;
    scannedUsers = res.users;
    scanErrors = res.errors;
  } else {
    index = await listUserFiles(sourceUser);
  }
  const seen = new Set<string>();
  const affected: DriveFile[] = [];
  for (const id of fileIds) {
    for (const f of subtreeFrom(index, id)) {
      if (!seen.has(f.id)) {
        seen.add(f.id);
        affected.push(f);
      }
    }
  }
  return { affected, index, scannedUsers, scanErrors };
}

/**
 * Find a file anywhere in the org by id (e.g. from a pasted Drive link) using
 * the deep index, so the caller doesn't need to know who owns it.
 */
transferRouter.post(
  '/locate',
  h(async (req, res) => {
    const fileId = requireFileId(req.body?.fileId);
    const users = await listDomainUsers();
    const { files, users: scannedUsers } = await buildDeepIndex(users.map((u) => u.email));
    const file = files.find((f) => f.id === fileId);
    if (!file) {
      return res.status(404).json({
        error: `No user in the domain owns a file with id ${fileId}. (External or shared-drive files can't be located.)`,
      });
    }
    res.json({ file, scannedUsers });
  }),
);

/**
 * Dry run: list every file/folder that would change owner, with a per-owner
 * breakdown — folders can contain items owned by several people.
 */
transferRouter.post(
  '/preview',
  h(async (req, res) => {
    const sourceUser = requireEmail(req.body?.sourceUser, 'sourceUser');
    const fileIds = requireFileIds(req.body);
    const deep = Boolean(req.body?.deep);
    const { affected, scannedUsers, scanErrors } = await enumerateSubtrees(sourceUser, fileIds, deep);
    if (affected.length === 0) {
      throw badRequest(
        deep
          ? `Selected files were not found in any user's Drive.`
          : `Selected files not found in ${sourceUser}'s Drive.`,
      );
    }
    const byOwner = new Map<string, number>();
    for (const f of affected) byOwner.set(f.owner, (byOwner.get(f.owner) ?? 0) + 1);
    res.json({
      count: affected.length,
      files: affected.map((f) => ({
        id: f.id,
        name: f.name,
        mimeType: f.mimeType,
        isFolder: f.isFolder,
        owner: f.owner,
      })),
      owners: [...byOwner.entries()].map(([email, count]) => ({ email, count })),
      deep,
      scannedUsers,
      scanErrors,
    });
  }),
);

/**
 * Start an ownership transfer as a background job.
 *
 * - Selected roots owned by `sourceUser` transfer via recursive
 *   `gam user <source> transfer ownership <rootId> <target>` (phase 1).
 * - Everything else (other owners with claimAll/deep/consolidate, or
 *   source-owned strays outside phase-1 subtrees) transfers one file at a
 *   time by impersonating each owner (phase 2).
 */
transferRouter.post(
  '/start',
  h(async (req, res) => {
    const sourceUser = requireEmail(req.body?.sourceUser, 'sourceUser');
    const targetUser = requireEmail(req.body?.targetUser, 'targetUser');
    const fileIds = requireFileIds(req.body);
    const recursive = Boolean(req.body?.recursive);
    const claimAll = Boolean(req.body?.claimAll);
    const deep = Boolean(req.body?.deep);
    // Optional: after the transfer, move the selected roots into this folder
    // in the target user's Drive ('root' = their My Drive).
    const targetFolderId =
      req.body?.targetFolderId === 'root'
        ? 'root'
        : req.body?.targetFolderId
          ? requireFileId(req.body.targetFolderId, 'target folder id')
          : null;
    const label = String(req.body?.label ?? (fileIds.length === 1 ? fileIds[0] : `${fileIds.length} items`));

    const { affected, index, scannedUsers, scanErrors } = await enumerateSubtrees(sourceUser, fileIds, deep);
    const { consolidate, roots, phase1, phase1Covered, perFile, alreadyTarget, total, ownerCount } = planTransfer(
      { sourceUser, targetUser, fileIds, recursive, claimAll, deep },
      affected,
      index,
    );
    const job = createJob(
      'transfer',
      consolidate
        ? `Consolidate "${label}" to ${targetUser} (${total} items from ${ownerCount} owners${deep ? ', deep scan' : ''})`
        : `Transfer "${label}" to ${targetUser}${recursive ? ' (recursive)' : ''}${perFile.some((f) => f.owner !== sourceUser) ? ` — consolidating from ${ownerCount} owners` : ` from ${sourceUser}`}${deep ? ' (deep scan)' : ''}`,
      total,
    );
    jobLog(
      job,
      'info',
      `Items to transfer: ${total} (${phase1Covered.size} via recursive transfer, ${perFile.length} individually)`,
    );
    if (deep) jobLog(job, 'info', `Deep scan: enumerated the owned files of ${scannedUsers} users.`);
    for (const e of scanErrors) jobLog(job, 'stderr', `Deep scan could not read ${e}`);
    if (alreadyTarget.length > 0)
      jobLog(job, 'info', `Skipping ${alreadyTarget.length} item(s) already owned by ${targetUser}.`);

    if (targetFolderId)
      jobLog(
        job,
        'info',
        `After transfer, moving ${roots.length} item(s) into folder ${targetFolderId} in ${targetUser}'s Drive.`,
      );

    void runTransferJob(job, {
      sourceUser,
      targetUser,
      phase1,
      phase1Total: phase1Covered.size,
      perFile,
      moveRoots: targetFolderId ? roots.map((r) => ({ id: r.id, name: r.name })) : [],
      targetFolderId,
    });
    res.json({ jobId: job.id, job: jobView(getJob(job.id)!) });
  }),
);

interface TransferPlan {
  sourceUser: string;
  targetUser: string;
  phase1: { fileId: string; norecursion: boolean }[];
  phase1Total: number;
  perFile: DriveFile[];
  /** Selected roots to reparent into targetFolderId after the transfer. */
  moveRoots: { id: string; name: string }[];
  targetFolderId: string | null;
}

async function runTransferJob(job: Job, plan: TransferPlan): Promise<void> {
  let cancelled = false;
  let current: StreamHandle | null = null;
  job.handle = {
    child: null,
    cancel() {
      cancelled = true;
      current?.cancel();
    },
  };

  let mainProgress = 0;
  let extrasDone = 0;
  let failures = 0;
  const report = () => jobProgress(job, Math.min(mainProgress, plan.phase1Total) + extrasDone);

  const runOne = async (args: string[], countLines: boolean): Promise<number> => {
    jobLog(job, 'info', `Running: gam ${args.join(' ')}`);
    const { handle, done } = await streamGam(args, (line, stream) => {
      if (!line.trim()) return;
      // Google's auth library probes the Regional Access Boundary policy when
      // minting service-account tokens; a 403 there is expected (the SA has no
      // RAB permission) and harmless — the API call itself still succeeds.
      if (/Regional Access Boundary/i.test(line)) {
        jobLog(job, 'info', `(benign auth warning — safe to ignore) ${line}`);
        return;
      }
      jobLog(job, stream, line);
      if (countLines && stream === 'stdout' && /transferred|ownership|changed/i.test(line)) {
        mainProgress += 1;
        report();
      }
    });
    current = handle;
    const code = await done;
    current = null;
    return code;
  };

  try {
    for (const p of plan.phase1) {
      if (cancelled) break;
      const args = ['user', plan.sourceUser, 'transfer', 'ownership', p.fileId, plan.targetUser];
      if (p.norecursion) args.push('norecursion');
      const code = await runOne(args, true);
      if (code !== 0 && !cancelled) failures += 1;
    }
    if (!cancelled) {
      mainProgress = plan.phase1Total;
      report();
    }

    for (const f of plan.perFile) {
      if (cancelled) break;
      const code = await runOne(
        ['user', f.owner, 'transfer', 'ownership', f.id, plan.targetUser, 'norecursion'],
        false,
      );
      if (code === 0) {
        extrasDone += 1;
      } else if (!cancelled) {
        failures += 1;
        jobLog(job, 'stderr', `Failed to transfer "${f.name}" (${f.id}) from ${f.owner} — continuing with the rest.`);
      }
      report();
    }

    // Phase 3: reparent the selected roots into the requested folder, acting
    // as the target user (who owns them now). Children follow automatically.
    if (plan.targetFolderId && !cancelled) {
      for (const r of plan.moveRoots) {
        if (cancelled) break;
        try {
          const out = await runGam([
            'user',
            plan.targetUser,
            'update',
            'drivefile',
            r.id,
            'parentid',
            plan.targetFolderId,
          ]);
          jobLog(job, 'stdout', out.trim() || `Moved "${r.name}" into ${plan.targetFolderId}`);
        } catch (e) {
          failures += 1;
          jobLog(job, 'stderr', `Failed to move "${r.name}" (${r.id}): ${(e as Error).message}`);
        }
      }
    }
  } catch (e) {
    failures += 1;
    jobLog(job, 'stderr', (e as Error).message);
  }

  // Ownership changed (even a cancelled job may have completed some items) —
  // the cached deep index now attributes files to their old owners.
  invalidateDeepIndex();

  if (cancelled) {
    jobLog(job, 'info', 'Job cancelled.');
    finishJob(job, 'cancelled');
  } else if (failures > 0) {
    jobLog(job, 'info', `Finished with ${failures} failure(s) — see log above.`);
    finishJob(job, 'failed');
  } else {
    jobLog(job, 'info', 'All transfers completed.');
    finishJob(job, 'succeeded');
  }
}
