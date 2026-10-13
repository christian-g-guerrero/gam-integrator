import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { verifyExportDir } from './verifyExport.js';

const sha = (b: Buffer | string) => createHash('sha256').update(b).digest('hex');
const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })));

function record(over: Record<string, unknown> = {}) {
  return {
    schema_version: 2,
    mailbox: 'a@x.test',
    id: '18f0000000000001',
    thread_id: '18f0000000000001',
    internal_date: '2026-01-02T03:04:05Z',
    date: 'Fri, 2 Jan 2026 03:04:05 +0000',
    date_iso: '2026-01-02T03:04:05.000Z',
    message_id: '<m1@x.test>',
    in_reply_to: null,
    references: [],
    from: [{ name: 'B', email: 'b@x.test' }],
    sender: [],
    to: [{ name: '', email: 'a@x.test' }],
    cc: [],
    bcc: [],
    reply_to: [],
    delivered_to: ['a@x.test'],
    headers_raw: {},
    subject: 'Hi',
    snippet: "it's",
    labels: [
      { id: 'INBOX', name: 'INBOX' },
      { id: 'Label_1', name: 'Work' },
    ],
    size_estimate: 100,
    body_status: 'ok',
    body_text: 'hello\r\n',
    body_html: null,
    body_text_stripped: 'hello\n',
    attachments: [
      {
        attachment_id: 'att-1',
        name: 'a.txt',
        mime_type: 'text/plain',
        size: 3,
        sha256: sha('abc'),
        inline: false,
        content_id: null,
        path: 'attachments/18f0000000000001/att-1-a.txt',
      },
    ],
    ...over,
  };
}

function exportDir(records: object[], opts: { attach?: string; manifest?: Record<string, unknown> } = {}) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'verify-test-'));
  dirs.push(dir);
  const jsonl = records.map((r) => JSON.stringify(r) + '\n').join('');
  writeFileSync(path.join(dir, 'mailbox.jsonl'), jsonl);
  mkdirSync(path.join(dir, 'attachments/18f0000000000001'), { recursive: true });
  writeFileSync(path.join(dir, 'attachments/18f0000000000001/att-1-a.txt'), opts.attach ?? 'abc');
  const manifest = {
    schema_version: 2,
    complete: true,
    mailbox: 'a@x.test',
    exported_at: '2026-01-02T00:00:00Z',
    exporter: {},
    format: 'jsonl',
    query: '',
    include_spam_trash: false,
    include_attachments: true,
    message_count: records.length,
    gmail_messages_total: records.length,
    failed_ids: [],
    attachment_count: records.length,
    attachment_bytes: 3 * records.length,
    gam_commands: [],
    files: [{ path: 'mailbox.jsonl', bytes: Buffer.byteLength(jsonl), sha256: sha(jsonl), lines: records.length }],
    ...opts.manifest,
  };
  writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(manifest));
  return dir;
}

describe('verifyExportDir', () => {
  it('passes a well-formed export', () => {
    const r = verifyExportDir(exportDir([record()]));
    expect(r.failures).toEqual({});
    expect(r.ok).toBe(true);
    expect(r.stats.records).toBe(1);
  });

  it('catches a tampered JSONL (sha256 / bytes)', () => {
    const r = verifyExportDir(
      exportDir([record()], { manifest: { files: [{ path: 'mailbox.jsonl', bytes: 1, sha256: 'x', lines: 1 }] } }),
    );
    expect(r.ok).toBe(false);
    expect(Object.keys(r.failures)).toEqual(
      expect.arrayContaining([
        'manifest: mailbox.jsonl sha256 mismatch',
        'manifest: mailbox.jsonl byte count mismatch',
      ]),
    );
  });

  it('catches a corrupted attachment and reports the Gmail id', () => {
    const r = verifyExportDir(exportDir([record()], { attach: 'abd' }));
    expect(r.failures['attachment: sha256 mismatch']).toBe(1);
    expect(r.examples['attachment: sha256 mismatch']).toEqual(['18f0000000000001']);
  });

  it('catches contract violations in a record', () => {
    const r = verifyExportDir(
      exportDir([record({ schema_version: 1, body_status: 'ok', body_text: null, snippet: 'it&#39;s' })]),
    );
    expect(Object.keys(r.failures)).toEqual(
      expect.arrayContaining([
        'record: schema_version != 2',
        'record: body_status ok but no body',
        'record: snippet still HTML-escaped',
      ]),
    );
  });

  it('flags complete:true with failed ids', () => {
    const r = verifyExportDir(exportDir([record()], { manifest: { failed_ids: ['zzz'] } }));
    expect(r.failures['manifest: complete disagrees with failed_ids']).toBe(1);
  });
});
