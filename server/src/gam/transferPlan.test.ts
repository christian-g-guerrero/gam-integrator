import { describe, expect, it } from 'vitest';
import { subtreeFrom, type DriveFile } from './drive.js';
import { planTransfer, type TransferRequest } from './transferPlan.js';

const A = 'alice@x.test';
const B = 'bob@x.test';
const C = 'carol@x.test';

const file = (id: string, owner: string, parent = '', isFolder = false): DriveFile => ({
  id,
  name: id,
  mimeType: isFolder ? 'application/vnd.google-apps.folder' : 'text/plain',
  size: 1,
  parent,
  owner,
  modifiedTime: '',
  webViewLink: '',
  isFolder,
});

// Alice's folder F holds her file a1, Bob's file b1, Carol's file t1 (the target's) and Alice's subfolder S with a2.
const INDEX = [
  file('F', A, '', true),
  file('a1', A, 'F'),
  file('b1', B, 'F'),
  file('t1', C, 'F'),
  file('S', A, 'F', true),
  file('a2', A, 'S'),
  file('lone', B),
];

function plan(over: Partial<TransferRequest>, ids = ['F']) {
  const req: TransferRequest = {
    sourceUser: A,
    targetUser: C,
    fileIds: ids,
    recursive: false,
    claimAll: false,
    deep: false,
    ...over,
  };
  const affected = [...new Set(ids.flatMap((id) => subtreeFrom(INDEX, id)))];
  return planTransfer(req, affected, INDEX);
}
const ids = (fs: DriveFile[] | Set<string>) => [...fs].map((f) => (typeof f === 'string' ? f : f.id)).sort();

describe('planTransfer', () => {
  it('non-recursive source-owned folder: one phase-1 norecursion command, nothing per file', () => {
    const p = plan({});
    expect(p.phase1).toEqual([{ fileId: 'F', norecursion: true }]);
    expect(ids(p.phase1Covered)).toEqual(['F']);
    expect(p.perFile).toEqual([]);
    expect(p.total).toBe(1);
  });

  it('recursive: phase 1 covers the source-owned subtree; other owners skipped without claimAll', () => {
    const p = plan({ recursive: true });
    expect(p.phase1).toEqual([{ fileId: 'F', norecursion: false }]);
    expect(ids(p.phase1Covered)).toEqual(['F', 'S', 'a1', 'a2']);
    expect(p.perFile).toEqual([]);
    expect(ids(p.alreadyTarget)).toEqual(['t1']);
    expect(p.total).toBe(4);
  });

  it('recursive + claimAll: other owners transfer per file; the target-owned item is skipped', () => {
    const p = plan({ recursive: true, claimAll: true });
    expect(ids(p.perFile)).toEqual(['b1']);
    expect(p.total).toBe(5);
    expect(p.ownerCount).toBe(2);
  });

  it('deep: no phase 1 — every non-target item goes per file, including other owners', () => {
    const p = plan({ recursive: true, deep: true });
    expect(p.phase1).toEqual([]);
    expect(ids(p.perFile)).toEqual(['F', 'S', 'a1', 'a2', 'b1']);
  });

  it('consolidate (source = target): no phase 1, sweeps everything not yet owned by the target', () => {
    const p = plan({ sourceUser: C, targetUser: C, recursive: true });
    expect(p.consolidate).toBe(true);
    expect(p.phase1).toEqual([]);
    expect(ids(p.perFile)).toEqual(['F', 'S', 'a1', 'a2', 'b1']);
  });

  it("a single file owned by someone else: falls back to acting on the owner's behalf", () => {
    const p = plan({}, ['lone']);
    expect(p.phase1).toEqual([]);
    expect(ids(p.perFile)).toEqual(['lone']);
  });

  it('rejects when everything is already owned by the target', () => {
    expect(() => plan({}, ['t1'])).toThrow(/already owned by carol/);
  });

  it('rejects when selected files are not in the scanned Drive', () => {
    expect(() =>
      planTransfer(
        { sourceUser: A, targetUser: C, fileIds: ['nope'], recursive: false, claimAll: false, deep: false },
        [],
        INDEX,
      ),
    ).toThrow(/not found/);
  });
});
