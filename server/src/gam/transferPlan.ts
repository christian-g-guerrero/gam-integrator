import { subtreeFrom, type DriveFile } from './drive.js';
import { badRequest } from '../util.js';

export interface TransferRequest {
  sourceUser: string;
  targetUser: string;
  fileIds: string[];
  recursive: boolean;
  claimAll: boolean;
  deep: boolean;
}

export interface PlannedTransfer {
  /** sourceUser === targetUser: sweep everything not yet owned by the target over to them. */
  consolidate: boolean;
  roots: DriveFile[];
  /** What the transfer acts on: the whole subtree when recursive, else just the roots. */
  items: DriveFile[];
  /** One recursive `gam user <source> transfer ownership <root> <target>` per entry. */
  phase1: { fileId: string; norecursion: boolean }[];
  /** Ids phase 1 moves (the source-owned part of each phase-1 subtree). */
  phase1Covered: Set<string>;
  /** Transferred one at a time by impersonating each owner. */
  perFile: DriveFile[];
  alreadyTarget: DriveFile[];
  total: number;
  /** Distinct current owners (other than the target) among `items`. */
  ownerCount: number;
}

/**
 * Decide what an ownership transfer does — pure, so the flag matrix is testable without GAM.
 * `affected` is the union of the selected subtrees; `index` the files they were found in.
 *
 * - Selected roots owned by `sourceUser` go via recursive transfer (phase 1) — except in
 *   deep/consolidate mode, where the recursive command would only traverse what the source sees.
 * - Everything else (other owners when claimAll/deep/consolidate, or source-owned strays outside
 *   phase-1 subtrees) is transferred per file.
 */
export function planTransfer(req: TransferRequest, affected: DriveFile[], index: DriveFile[]): PlannedTransfer {
  const { sourceUser, targetUser, fileIds, recursive, claimAll, deep } = req;
  const consolidate = sourceUser === targetUser;
  const roots = fileIds.map((id) => affected.find((f) => f.id === id)).filter((f): f is DriveFile => Boolean(f));
  if (roots.length === 0) throw badRequest(`Selected files not found in ${sourceUser}'s Drive.`);
  const items = recursive ? affected : roots;

  const phase1Roots = consolidate || deep ? [] : roots.filter((r) => r.owner === sourceUser);
  const phase1Covered = new Set<string>();
  for (const r of phase1Roots) {
    if (recursive && r.isFolder) {
      for (const f of subtreeFrom(index, r.id)) {
        if (f.owner === sourceUser) phase1Covered.add(f.id);
      }
    } else {
      phase1Covered.add(r.id);
    }
  }

  const alreadyTarget = items.filter((f) => f.owner === targetUser);
  // When nothing is phase-1 transferable (e.g. a single file owned by someone
  // else), acting on the owners' behalf is the only correct move.
  const includeOthers = claimAll || consolidate || deep || phase1Roots.length === 0;
  const perFile = items.filter(
    (f) => f.owner !== targetUser && !phase1Covered.has(f.id) && (f.owner === sourceUser || includeOthers),
  );

  const total = phase1Covered.size + perFile.length;
  if (total === 0) {
    throw badRequest(
      alreadyTarget.length > 0
        ? `Everything selected is already owned by ${targetUser}.`
        : 'Nothing to transfer for the selected owner. Enable "include items owned by other users" for mixed-ownership folders.',
    );
  }

  return {
    consolidate,
    roots,
    items,
    phase1: phase1Roots.map((r) => ({ fileId: r.id, norecursion: !(recursive && r.isFolder) })),
    phase1Covered,
    perFile,
    alreadyTarget,
    total,
    ownerCount: new Set(items.filter((f) => f.owner !== targetUser).map((f) => f.owner)).size,
  };
}
