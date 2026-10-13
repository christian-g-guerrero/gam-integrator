import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { deleteExports, listExports } from './exportFiles.js';

const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })));

function fixture() {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'exports-test-'));
  dirs.push(dir);
  const stage = path.join(dir, '.stage');
  mkdirSync(stage);
  writeFileSync(path.join(stage, 'manifest.json'), JSON.stringify({ mailbox: 'a@x.test', complete: false }));
  writeFileSync(path.join(stage, 'mailbox.jsonl'), '{}\n');
  execFileSync('/usr/bin/zip', ['-r', '-q', path.join(dir, 'job-zip.zip'), '.'], { cwd: stage });
  rmSync(stage, { recursive: true });
  writeFileSync(path.join(dir, 'job-v1.jsonl'), '{"user":"b@x.test","subject":"s"}\n{"user":"b@x.test"}\n');
  writeFileSync(path.join(dir, 'job-csv.csv'), 'User,id,Subject\nc@x.test,1,hi\n');
  mkdirSync(path.join(dir, 'job-leftover/.eml'), { recursive: true });
  writeFileSync(path.join(dir, 'job-leftover/.eml/Msg-1.eml'), 'x');
  writeFileSync(path.join(dir, '.DS_Store'), '');
  return dir;
}

describe('listExports', () => {
  it('labels each export with its mailbox and completeness, and flags live jobs', () => {
    const rows = Object.fromEntries(listExports(fixture(), new Set(['job-csv'])).map((r) => [r.name, r]));
    expect(Object.keys(rows).sort()).toEqual(['job-csv.csv', 'job-leftover', 'job-v1.jsonl', 'job-zip.zip']);
    expect(rows['job-zip.zip']).toMatchObject({ kind: 'zip', mailbox: 'a@x.test', complete: false, live: false });
    expect(rows['job-v1.jsonl']).toMatchObject({ kind: 'jsonl', mailbox: 'b@x.test', complete: null });
    expect(rows['job-csv.csv']).toMatchObject({ kind: 'csv', mailbox: 'c@x.test', live: true });
    expect(rows['job-leftover']).toMatchObject({ kind: 'folder', mailbox: null, bytes: 1 });
  });
});

describe('deleteExports', () => {
  it('deletes only listed, non-live names — ignores unknown names and path tricks', () => {
    const dir = fixture();
    writeFileSync(path.join(os.tmpdir(), 'outside-exports-test'), 'keep');
    const r = deleteExports(
      dir,
      ['job-zip.zip', 'job-leftover', 'job-csv.csv', '../outside-exports-test', 'nope.zip'],
      new Set(['job-csv']),
    );
    expect(r.deleted.sort()).toEqual(['job-leftover', 'job-zip.zip']);
    expect(existsSync(path.join(dir, 'job-csv.csv'))).toBe(true);
    expect(existsSync(path.join(os.tmpdir(), 'outside-exports-test'))).toBe(true);
    rmSync(path.join(os.tmpdir(), 'outside-exports-test'));
  });
});
