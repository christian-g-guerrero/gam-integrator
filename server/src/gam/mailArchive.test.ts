import PostalMime from 'postal-mime';
import { describe, expect, it } from 'vitest';
import { parseGamCsv } from './csv.js';
import {
  buildArchiveRecord,
  indexRowFromCsv,
  LABEL_DELIMITER,
  normalizeAddresses,
  resolveLabels,
  SCHEMA_VERSION,
  type IndexRow,
} from './mailArchive.js';

// Golden body: CRLF, lone LF, blank lines, a literal backslash, and the literal text "\n".
const GOLDEN_BODY = 'crlf line\r\nlf line\n\n\nafter blanks\nbackslash \\ and v\\:* and literal \\n text\r\nend';
const HTML = '<!DOCTYPE html><html><body><p>Hi &amp; bye</p></body></html>';

const b64 = (v: string) =>
  Buffer.from(v, 'utf8')
    .toString('base64')
    .replace(/(.{76})/g, '$1\r\n');

const GOLDEN_EML = [
  'From: "Diego, R" <Diego@Example.com>',
  'Sender: assistant@example.com',
  'To: undisclosed-recipients:;',
  'Cc: Team: a@x.com, b@y.com;, "Q" <q@z.com>',
  'Bcc: hidden@x.com',
  'Reply-To: replies@example.com',
  'Delivered-To: jane@example.com',
  'Delivered-To: jane-alias@example.com',
  'Subject: =?UTF-8?B?TkVXIE9SREVSIFwgUmU6?=',
  'Date: Tue, 22 Oct 2024 00:18:42 -0700',
  'Message-ID: <CAxyz@mail.gmail.com>',
  'In-Reply-To: <parent@mail.gmail.com>',
  'References: <root@mail.gmail.com>',
  ' <parent@mail.gmail.com>',
  'MIME-Version: 1.0',
  'Content-Type: multipart/mixed; boundary="B1"',
  '',
  '--B1',
  'Content-Type: multipart/alternative; boundary="B2"',
  '',
  '--B2',
  'Content-Type: text/plain; charset=utf-8',
  'Content-Transfer-Encoding: base64',
  '',
  b64(GOLDEN_BODY),
  '--B2',
  'Content-Type: text/html; charset=utf-8',
  '',
  HTML,
  '--B2--',
  '--B1',
  'Content-Type: application/pdf; name="quote.pdf"',
  'Content-Disposition: attachment; filename="quote.pdf"',
  'Content-Transfer-Encoding: base64',
  '',
  Buffer.from('PDFDATA').toString('base64'),
  '--B1--',
  '',
].join('\r\n');

const INDEX: IndexRow = {
  id: '192b3179c821a4f9',
  threadId: '192b3179c821a4f0',
  messageId: '<CAxyz@mail.gmail.com>',
  internalDate: '2024-10-22T00:18:44-07:00',
  labels: ['INBOX', 'Clients - North', 'CATEGORY_UPDATES'].join(LABEL_DELIMITER),
  snippet: "it's the quote you asked for",
  sizeEstimate: '66123',
};
const LABEL_IDS = new Map([
  ['INBOX', 'INBOX'],
  ['Clients - North', 'Label_12'],
  ['CATEGORY_UPDATES', 'CATEGORY_UPDATES'],
]);

const parse = (eml: string) => PostalMime.parse(eml, { attachmentEncoding: 'arraybuffer' });

describe('buildArchiveRecord — golden fixture', () => {
  it('round-trips body bytes exactly (CRLF, LF, blank lines, backslash, literal \\n)', async () => {
    const rec = buildArchiveRecord({
      mailbox: 'jane@example.com',
      index: INDEX,
      labelIds: LABEL_IDS,
      email: await parse(GOLDEN_EML),
    });
    expect(rec.body_text).toBe(GOLDEN_BODY);
    // …and survives the JSONL serialization round trip.
    expect(JSON.parse(JSON.stringify(rec)).body_text).toBe(GOLDEN_BODY);
    expect(rec.body_status).toBe('ok');
    expect(rec.schema_version).toBe(SCHEMA_VERSION);
  });

  it('keeps HTML in body_html only', async () => {
    const rec = buildArchiveRecord({
      mailbox: 'jane@example.com',
      index: INDEX,
      labelIds: LABEL_IDS,
      email: await parse(GOLDEN_EML),
    });
    expect(rec.body_html?.trim()).toBe(HTML);
    expect(rec.body_text).not.toMatch(/<html/i);
  });

  it('carries threading/identity headers and decoded subject (backslash not doubled)', async () => {
    const rec = buildArchiveRecord({
      mailbox: 'jane@example.com',
      index: INDEX,
      labelIds: LABEL_IDS,
      email: await parse(GOLDEN_EML),
    });
    expect(rec.message_id).toBe('<CAxyz@mail.gmail.com>');
    expect(rec.in_reply_to).toBe('<parent@mail.gmail.com>');
    expect(rec.references).toEqual(['<root@mail.gmail.com>', '<parent@mail.gmail.com>']);
    expect(rec.subject).toBe('NEW ORDER \\ Re:');
    expect(rec.date).toBe('Tue, 22 Oct 2024 00:18:42 -0700');
    expect(rec.date_iso).toBe('2024-10-22T07:18:42.000Z');
    expect(rec.internal_date).toBe('2024-10-22T07:18:44.000Z');
  });

  it('parses addresses with RFC 5322 groups, drops undisclosed-recipients, keeps raw headers', async () => {
    const rec = buildArchiveRecord({
      mailbox: 'jane@example.com',
      index: INDEX,
      labelIds: LABEL_IDS,
      email: await parse(GOLDEN_EML),
    });
    expect(rec.from).toEqual([{ name: 'Diego, R', email: 'Diego@Example.com' }]);
    expect(rec.sender).toEqual([{ name: '', email: 'assistant@example.com' }]);
    expect(rec.to).toEqual([]);
    expect(rec.cc).toEqual([
      { name: '', email: 'a@x.com' },
      { name: '', email: 'b@y.com' },
      { name: 'Q', email: 'q@z.com' },
    ]);
    expect(rec.bcc).toEqual([{ name: '', email: 'hidden@x.com' }]);
    expect(rec.reply_to).toEqual([{ name: '', email: 'replies@example.com' }]);
    expect(rec.delivered_to).toEqual(['jane@example.com', 'jane-alias@example.com']);
    expect(rec.headers_raw.to).toBe('undisclosed-recipients:;');
    expect(rec.headers_raw.subject).toBe('=?UTF-8?B?TkVXIE9SREVSIFwgUmU6?=');
    expect(rec.headers_raw.references).toBe('<root@mail.gmail.com> <parent@mail.gmail.com>');
  });

  it('emits labels as {id, name} with spaces intact', async () => {
    const rec = buildArchiveRecord({
      mailbox: 'jane@example.com',
      index: INDEX,
      labelIds: LABEL_IDS,
      email: await parse(GOLDEN_EML),
    });
    expect(rec.labels).toEqual([
      { id: 'INBOX', name: 'INBOX' },
      { id: 'Label_12', name: 'Clients - North' },
      { id: 'CATEGORY_UPDATES', name: 'CATEGORY_UPDATES' },
    ]);
  });

  it('links each attachment to its message with a stable id, path and sha256', async () => {
    const written: Record<string, Uint8Array> = {};
    const rec = buildArchiveRecord({
      mailbox: 'jane@example.com',
      index: INDEX,
      labelIds: LABEL_IDS,
      email: await parse(GOLDEN_EML),
      attachmentSink: { write: (p, b) => (written[p] = b) },
    });
    expect(rec.attachments).toEqual([
      {
        attachment_id: 'att-1',
        name: 'quote.pdf',
        mime_type: 'application/pdf',
        size: 7,
        sha256: '1ad9615552126eb88b27e3f5c20c9932a9efafe7a58a790bf8d0d92d0fdc5661', // sha256("PDFDATA")
        inline: false,
        content_id: null,
        path: 'attachments/192b3179c821a4f9/att-1-quote.pdf',
      },
    ]);
    expect(Buffer.from(written['attachments/192b3179c821a4f9/att-1-quote.pdf']).toString()).toBe('PDFDATA');
  });

  it('computes body_text_stripped from the true body (CRLF-tolerant)', async () => {
    const eml = [
      'From: a@b.com',
      'Subject: re',
      'Content-Type: text/plain; charset=utf-8',
      'Content-Transfer-Encoding: base64',
      '',
      b64('Sounds good.\r\n\r\nOn Mon, Oct 28, 2024 at 9:55 AM Mike <mike@example.com> wrote:\r\n> earlier\r\n'),
      '',
    ].join('\r\n');
    const rec = buildArchiveRecord({ mailbox: 'x@y.z', index: INDEX, labelIds: LABEL_IDS, email: await parse(eml) });
    expect(rec.body_text_stripped).toBe('Sounds good.');
  });
});

describe('buildArchiveRecord — missing bodies', () => {
  it('never emits placeholder text: HTML-only mail has body_text null', async () => {
    const eml = ['From: a@b.com', 'Subject: x', 'Content-Type: text/html; charset=utf-8', '', HTML, ''].join('\r\n');
    const rec = buildArchiveRecord({ mailbox: 'x@y.z', index: INDEX, labelIds: LABEL_IDS, email: await parse(eml) });
    expect(rec.body_text).toBeNull();
    expect(rec.body_html).toContain('<p>Hi &amp; bye</p>');
    expect(rec.body_status).toBe('ok');
  });

  it('moves an HTML document sent as text/plain out of body_text', async () => {
    const eml = ['From: a@b.com', 'Subject: x', 'Content-Type: text/plain; charset=utf-8', '', HTML, ''].join('\r\n');
    const rec = buildArchiveRecord({ mailbox: 'x@y.z', index: INDEX, labelIds: LABEL_IDS, email: await parse(eml) });
    expect(rec.body_text).toBeNull();
    expect(rec.body_html).toContain('<!DOCTYPE html>');
  });

  it('marks a message with no text or HTML part as empty', async () => {
    const eml = [
      'From: a@b.com',
      'Subject: scan',
      'Content-Type: application/pdf; name="scan.pdf"',
      'Content-Disposition: attachment; filename="scan.pdf"',
      'Content-Transfer-Encoding: base64',
      '',
      Buffer.from('PDF').toString('base64'),
      '',
    ].join('\r\n');
    const rec = buildArchiveRecord({ mailbox: 'x@y.z', index: INDEX, labelIds: LABEL_IDS, email: await parse(eml) });
    expect(rec.body_status).toBe('empty');
    expect(rec.body_text).toBeNull();
    expect(rec.body_html).toBeNull();
    expect(rec.attachments).toHaveLength(1);
    expect(rec.attachments[0].path).toBeNull(); // no sink → text-only export
  });

  it('keeps Gmail metadata (and message_id) when the raw message could not be fetched', () => {
    const rec = buildArchiveRecord({
      mailbox: 'x@y.z',
      index: INDEX,
      labelIds: LABEL_IDS,
      email: null,
      failure: 'unavailable',
    });
    expect(rec.body_status).toBe('unavailable');
    expect(rec.body_text).toBeNull();
    expect(rec.message_id).toBe('<CAxyz@mail.gmail.com>');
    expect(rec.labels).toHaveLength(3);
    expect(rec.size_estimate).toBe(66123);
  });
});

describe('GAM CSV with csv_output_no_escape_char', () => {
  // Bytes produced by GAM's own writer settings (Python 3.14 csv.DictWriter, QUOTE_MINIMAL,
  // doublequote, escapechar=None) — see runner.csvArgs.
  const GAM_CSV =
    'User,threadId,id,Subject,Labels,Body\n' +
    'jane@example.com,192b3179c821a4f9,192b3179c821a4f9,NEW ORDER \\ Re: x,INBOX\u001fClients - North,"crlf\r\nlf\n\nv\\:* lit\\n ""q"", end"\n';

  it('parses back to the original field values (no doubled backslashes)', () => {
    const [row] = parseGamCsv(GAM_CSV);
    expect(row.Subject).toBe('NEW ORDER \\ Re: x');
    expect(row.Body).toBe('crlf\r\nlf\n\nv\\:* lit\\n "q", end');
  });

  it('splits labels on the control-char delimiter so names with spaces survive', () => {
    const [row] = parseGamCsv(GAM_CSV);
    expect(resolveLabels(indexRowFromCsv(row).labels, LABEL_IDS)).toEqual([
      { id: 'INBOX', name: 'INBOX' },
      { id: 'Label_12', name: 'Clients - North' },
    ]);
  });
});

describe('normalizeAddresses', () => {
  it('drops entries without a usable address (broken quotes, empty groups)', () => {
    expect(
      normalizeAddresses([
        { name: 'undisclosed-recipients', group: [] },
        { name: 'x', address: 'not-an-email' },
        { name: 'Diego', address: 'diego@x.com' },
      ]),
    ).toEqual([{ name: 'Diego', email: 'diego@x.com' }]);
  });
});
