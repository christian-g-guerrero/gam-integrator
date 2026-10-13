/**
 * GAM_MOCK=1 fixture adapter — lets the whole UI run against a fake
 * Workspace domain (mockdomain.com) without GAM or a real Google org.
 * Implements just enough of the GAM command surface used by the routes.
 */
import type { StreamHandle } from './runner.js';

const DOMAIN = 'mockdomain.com';

interface MockFile {
  id: string;
  name: string;
  mimeType: string;
  size: string;
  parents: string; // single parent id ('' = root)
  modifiedTime: string;
  webViewLink: string;
  /** Set when the file sits in this user's tree but is owned by someone else. */
  owner?: string;
}

interface MockAcl {
  id: string;
  type: string;
  emailAddress: string;
  role: string;
}

const USERS = [
  { primaryEmail: `alice@${DOMAIN}`, 'name.fullName': 'Alice Anderson', suspended: 'False', orgUnitPath: '/Staff' },
  { primaryEmail: `bob@${DOMAIN}`, 'name.fullName': 'Bob Brown', suspended: 'False', orgUnitPath: '/Staff' },
  { primaryEmail: `carol@${DOMAIN}`, 'name.fullName': 'Carol Chen', suspended: 'False', orgUnitPath: '/Faculty' },
  { primaryEmail: `dave@${DOMAIN}`, 'name.fullName': 'Dave Diaz', suspended: 'True', orgUnitPath: '/Former Employees' },
  { primaryEmail: `erin@${DOMAIN}`, 'name.fullName': 'Erin Evans', suspended: 'False', orgUnitPath: '/Faculty' },
  { primaryEmail: `admin@${DOMAIN}`, 'name.fullName': 'Workspace Admin', suspended: 'False', orgUnitPath: '/' },
];

const FOLDER = 'application/vnd.google-apps.folder';
const DOC = 'application/vnd.google-apps.document';
const SHEET = 'application/vnd.google-apps.spreadsheet';
const PDF = 'application/pdf';

const filesByUser = new Map<string, MockFile[]>();
const aclsByFile = new Map<string, MockAcl[]>();

function seedUser(email: string): void {
  if (filesByUser.has(email)) return;
  const u = email.split('@')[0];
  const mk = (id: string, name: string, mimeType: string, parents: string, size = '0'): MockFile => ({
    id: `${u}_${id}`,
    name,
    mimeType,
    size,
    parents,
    modifiedTime: '2026-06-15T10:30:00.000Z',
    webViewLink: `https://drive.google.com/file/d/${u}_${id}/view`,
  });
  const files: MockFile[] = [
    mk('root_projects', 'Projects', FOLDER, ''),
    mk('root_budget', `${u} Budget 2026`, SHEET, '', '48213'),
    mk('root_notes', 'Meeting Notes', DOC, '', '12930'),
    mk('root_scan', 'Signed Contract.pdf', PDF, '', '1943812'),
    mk('proj_alpha', 'Project Alpha', FOLDER, `${u}_root_projects`),
    mk('proj_plan', 'Alpha Plan', DOC, `${u}_proj_alpha`, '20114'),
    mk('proj_data', 'Alpha Data', SHEET, `${u}_proj_alpha`, '95412'),
    mk('proj_beta', 'Project Beta', FOLDER, `${u}_root_projects`),
    mk('beta_brief', 'Beta Brief', DOC, `${u}_proj_beta`, '8401'),
    // A file inside this user's Projects folder that belongs to a colleague —
    // exercises the mixed-ownership (consolidation) transfer path.
    {
      ...mk('proj_vendor', 'Vendor Assets (shared)', PDF, `${u}_root_projects`, '5242880'),
      owner: u === 'erin' ? `bob@${DOMAIN}` : `erin@${DOMAIN}`,
    },
  ];
  filesByUser.set(email, files);
  for (const f of files) {
    aclsByFile.set(f.id, [
      { id: 'acl_owner', type: 'user', emailAddress: f.owner ?? email, role: 'owner' },
      ...(f.name.includes('Plan')
        ? [{ id: 'acl_share1', type: 'user', emailAddress: `bob@${DOMAIN}`, role: 'writer' }]
        : []),
    ]);
  }
}

interface MockMsg {
  id: string;
  threadId: string;
  date: string;
  from: string;
  to: string;
  subject: string;
  labels: string[];
  snippet: string;
  body: string;
  /** HTML alternative; with an empty `body` the message is HTML-only. */
  html?: string;
  inReplyTo?: string;
  size: number;
  attachments?: { name: string; mimeType: string; size: number }[];
}

const mailByUser = new Map<string, MockMsg[]>();

function seedMail(email: string): MockMsg[] {
  if (mailByUser.has(email)) return mailByUser.get(email)!;
  const u = email.split('@')[0];
  const mk = (n: number, from: string, subject: string, labels: string[], daysAgo: number, size = 24576): MockMsg => ({
    id: `${u}_msg${n}`,
    threadId: `${u}_thr${n}`,
    date: new Date(Date.now() - daysAgo * 86400000).toUTCString(),
    from,
    to: email,
    subject,
    labels,
    snippet: `${subject} — snippet preview of the message content…`,
    body: `Full body of "${subject}"\n\nHello ${u},\n\nThis is the complete text of the mock email for testing the audit viewer.\n\nRegards,\n${from}`,
    size,
  });
  const msgs = [
    mk(
      1,
      `payments-noreply@google.com`,
      `Your invoice is available for ${DOMAIN}`,
      ['UNREAD', 'IMPORTANT', 'INBOX'],
      0,
    ),
    mk(2, `bob@${DOMAIN}`, 'Q3 budget review notes', ['INBOX'], 1),
    mk(3, `erin@${DOMAIN}`, 'Re: Project Alpha timeline', ['INBOX'], 2),
    mk(4, `noreply@vendor.example.com`, 'Receipt #48213 from Vendor Inc', ['INBOX', 'Receipts'], 3),
    { ...mk(5, email, 'Fwd: onboarding checklist', ['SENT'], 4), to: `carol@${DOMAIN}` },
    { ...mk(6, email, 'Re: contract signature needed', ['SENT'], 6), to: `dave@${DOMAIN}` },
    mk(7, `spam@sketchy.example.net`, 'You won a prize!!!', ['SPAM'], 5),
    // Archived: no INBOX label — visible only via All Mail / search, like real Gmail.
    mk(12, `hr@${DOMAIN}`, 'Signed offer letter (archived)', [], 30),
    mk(8, `old-newsletter@example.org`, 'Weekly digest (unsubscribed)', ['TRASH'], 9),
    {
      ...mk(9, `client@bigcorp.example.com`, 'Final brand assets — print-ready files', ['INBOX'], 12, 24_800_000),
      attachments: [
        { name: 'brand-assets-final.zip', mimeType: 'application/zip', size: 24_500_000 },
        { name: 'usage-guide.pdf', mimeType: 'application/pdf', size: 240_000 },
      ],
    },
    {
      ...mk(10, `erin@${DOMAIN}`, 'Re: Homepage mockups v4 (full res)', ['INBOX'], 15, 9_400_000),
      attachments: [{ name: 'homepage-v4.png', mimeType: 'image/png', size: 9_200_000 }],
    },
    {
      ...mk(11, email, 'Deliverables: campaign video draft', ['SENT'], 20, 48_100_000),
      to: `client@bigcorp.example.com`,
      attachments: [{ name: 'campaign-draft.mp4', mimeType: 'video/mp4', size: 47_900_000 }],
    },
    // Export edge cases: a label with spaces, a literal backslash + literal "\n", CRLF/LF/blank lines.
    {
      ...mk(13, `orders@${DOMAIN}`, 'NEW ORDER \\ Re: pricing', ['INBOX', 'Clients - North'], 7),
      body: 'Line one\r\nLine two\n\n\nPath C:\\orders\\new and literal \\n text\r\nEnd',
      inReplyTo: `${u}_msg2`,
    },
    // HTML-only newsletter (GAM's CSV body can be the literal "Body not available").
    {
      ...mk(14, `news@vendor.example.com`, 'October product update', ['INBOX', 'CATEGORY_UPDATES'], 8),
      body: '',
      html: '<!DOCTYPE html><html><body><h1>October update</h1><p>New &amp; improved.</p></body></html>',
    },
  ];
  mailByUser.set(email, msgs);
  return msgs;
}

const SYSTEM_LABELS = ['INBOX', 'SENT', 'DRAFT', 'SPAM', 'TRASH', 'UNREAD', 'IMPORTANT', 'STARRED', 'CATEGORY_UPDATES'];
const USER_LABEL_IDS: Record<string, string> = { Receipts: 'Label_Receipts', 'Clients - North': 'Label_12' };

function mockMailCommand(email: string, args: string[], rest: string): string | null {
  if (rest.startsWith('print gmailprofile')) {
    const msgs = seedMail(email);
    return toCsv([
      {
        emailAddress: email,
        messagesTotal: String(msgs.length),
        threadsTotal: String(new Set(msgs.map((m) => m.threadId)).size),
        historyId: '123456',
      },
    ]);
  }
  if (rest.startsWith('print labels')) {
    const msgs = seedMail(email);
    const count = (l: string) => msgs.filter((m) => m.labels.includes(l));
    const labels = [
      ...SYSTEM_LABELS.map((l) => ({ name: l, type: 'system' })),
      ...Object.keys(USER_LABEL_IDS).map((name) => ({ name, type: 'user' })),
    ];
    return toCsv(
      labels.map((l) => ({
        User: email,
        type: l.type,
        name: l.name,
        id: USER_LABEL_IDS[l.name] ?? l.name,
        messagesTotal: String(count(l.name).length),
        messagesUnread: String(count(l.name).filter((m) => m.labels.includes('UNREAD')).length),
      })),
    );
  }
  if (rest.startsWith('print messages')) {
    let msgs = seedMail(email);
    const idsIdx = args.indexOf('ids');
    const showBody = args.includes('showbody');
    if (idsIdx >= 0) msgs = msgs.filter((m) => args[idsIdx + 1].split(',').includes(m.id));
    const labelIdx = args.indexOf('labelids');
    if (labelIdx >= 0) {
      const id = args[labelIdx + 1];
      const label = Object.keys(USER_LABEL_IDS).find((n) => USER_LABEL_IDS[n] === id) ?? id;
      msgs = msgs.filter((m) => m.labels.includes(label));
    }
    const queryIdx = args.indexOf('query');
    // Real Gmail excludes Spam/Trash from listings unless addressed directly
    // (by id or label) or the query opts in with in:anywhere.
    const anywhere = queryIdx >= 0 && /\bin:anywhere\b/i.test(args[queryIdx + 1]);
    if (idsIdx < 0 && labelIdx < 0 && !anywhere) {
      msgs = msgs.filter((m) => !m.labels.includes('SPAM') && !m.labels.includes('TRASH'));
    }
    if (queryIdx >= 0) {
      const q = args[queryIdx + 1]
        .toLowerCase()
        .replace(/\bin:anywhere\b/g, '')
        .trim();
      const larger = q.match(/^larger:(\d+)(k|m)?$/);
      if (larger) {
        const bytes = Number(larger[1]) * (larger[2] === 'm' ? 1_048_576 : larger[2] === 'k' ? 1024 : 1);
        msgs = msgs.filter((m) => m.size >= bytes);
      } else if (q === 'has:attachment') {
        msgs = msgs.filter((m) => (m.attachments?.length ?? 0) > 0);
      } else if (q) {
        const term = q.replace(/^from:/, '');
        msgs = msgs.filter((m) => `${m.subject} ${m.from} ${m.body}`.toLowerCase().includes(term));
      }
    }
    const maxIdx = args.indexOf('max_to_print');
    if (maxIdx >= 0) msgs = msgs.slice(0, Number(args[maxIdx + 1]) || 50);
    // Like real GAM: `headers` picks the header columns, and `showdate` (internalDate) lands in the
    // same `Date` column — so it only survives when `date` isn't a requested header.
    const hi = args.indexOf('headers');
    const headers = hi >= 0 ? args[hi + 1].toLowerCase().split(',') : ['date', 'subject', 'from', 'to', 'message-id'];
    const di = args.indexOf('delimiter');
    const delim = di >= 0 ? args[di + 1] : ' ';
    const pick = (name: string, col: string, v: string) => (headers.includes(name) ? { [col]: v } : {});
    return toCsv(
      msgs.map((m) => ({
        User: email,
        threadId: m.threadId,
        id: m.id,
        ...pick('date', 'Date', m.date),
        ...pick('from', 'From', m.from),
        ...pick('to', 'To', m.to),
        ...pick('cc', 'Cc', ''),
        ...pick('subject', 'Subject', m.subject),
        ...pick('message-id', 'Message-ID', `<${m.id}@mock.example>`),
        ...(args.includes('showdate') ? { Date: new Date(m.date).toISOString() } : {}),
        LabelsCount: String(m.labels.length),
        Labels: m.labels.join(delim),
        Snippet: m.snippet,
        SizeEstimate: String(m.size),
        ...(args.includes('showattachments')
          ? Object.fromEntries([
              ['Attachments', String(m.attachments?.length ?? 0)],
              ...(m.attachments ?? []).flatMap((a, i) => [
                [`Attachments.${i}.name`, a.name],
                [`Attachments.${i}.mimeType`, a.mimeType],
                [`Attachments.${i}.size`, String(a.size)],
              ]),
            ])
          : {}),
        ...(showBody
          ? {
              Body: args.includes('convertcrnl')
                ? m.body.replace(/\r/g, '\\r').replace(/\n/g, '\\n')
                : m.body || m.html || 'Body not available',
            }
          : {}),
      })),
    );
  }
  return null;
}

function toCsv(rows: Record<string, string>[], headers?: string[]): string {
  if (rows.length === 0) return '';
  // union of keys — rows can have ragged columns (e.g. per-attachment fields)
  const cols = headers ?? [...new Set(rows.flatMap((r) => Object.keys(r)))];
  const esc = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  return [cols.join(','), ...rows.map((r) => cols.map((c) => esc(r[c] ?? '')).join(','))].join('\n') + '\n';
}

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

const flakyServed = new Set<string>();

/** RFC 822 source for a mock message — base64 parts so CRLF/backslashes round-trip exactly. */
function mockEml(email: string, m: MockMsg): string {
  const b64 = (v: string | Buffer) =>
    Buffer.from(v)
      .toString('base64')
      .replace(/(.{76})/g, '$1\r\n');
  const part = (type: string, content: string | Buffer, extra: string[] = []) =>
    [`Content-Type: ${type}`, 'Content-Transfer-Encoding: base64', ...extra, '', b64(content)].join('\r\n');
  const bodyParts = [
    ...(m.body ? [part('text/plain; charset=utf-8', m.body)] : []),
    ...(m.html ? [part('text/html; charset=utf-8', m.html)] : []),
  ];
  const alt = bodyParts.length > 1 ? multipart('alternative', bodyParts, 'ALT') : bodyParts[0];
  const atts = (m.attachments ?? []).map((a) =>
    part(`${a.mimeType}; name="${a.name}"`, `mock attachment content for ${a.name} from message ${m.id}\n`, [
      `Content-Disposition: attachment; filename="${a.name}"`,
    ]),
  );
  const root = atts.length ? multipart('mixed', [alt, ...atts], 'MIX') : alt;
  return [
    `From: ${m.from}`,
    `To: ${m.to}`,
    `Delivered-To: ${email}`,
    `Subject: =?UTF-8?B?${Buffer.from(m.subject).toString('base64')}?=`,
    `Date: ${m.date}`,
    `Message-ID: <${m.id}@mock.example>`,
    ...(m.inReplyTo ? [`In-Reply-To: <${m.inReplyTo}@mock.example>`, `References: <${m.inReplyTo}@mock.example>`] : []),
    'MIME-Version: 1.0',
    root,
  ].join('\r\n');
}

function multipart(kind: string, parts: string[], boundary: string): string {
  return [
    `Content-Type: multipart/${kind}; boundary="${boundary}"`,
    '',
    ...parts.flatMap((p) => [`--${boundary}`, p]),
    `--${boundary}--`,
    '',
  ].join('\r\n');
}

/** Drop GAM's leading `config <var> <value>` overrides (see runner.csvArgs) — the mock always emits plain CSV. */
function stripConfig(args: string[]): string[] {
  while (args[0] === 'config') args = args.slice(3);
  return args;
}

export async function run(rawArgs: string[]): Promise<string> {
  const args = stripConfig(rawArgs);
  const joined = args.join(' ');
  await delay(150);

  if (args[0] === 'version') return 'GAM 7.mock - https://github.com/GAM-team/GAM (mock mode)\n';
  if (joined.startsWith('oauth info')) return `Client OAuth2 File: (mock)\nGoogle Workspace Admin: admin@${DOMAIN}\n`;
  if (joined.startsWith('info domain')) return `Customer ID: C_mock\nPrimary Domain: ${DOMAIN}\n`;

  if (args[0] === 'print' && args[1] === 'users') {
    return toCsv(USERS);
  }

  if (args[0] === 'report' && args[1] === 'users') {
    const date = '2026-06-30';
    return toCsv(
      USERS.map((u, i) => ({
        email: u.primaryEmail,
        date,
        'accounts:drive_used_quota_in_mb': String([30505, 0, 1018, 18735, 106, 512][i % 6]),
        'accounts:gmail_used_quota_in_mb': String([946, 0, 18278, 19, 3427, 128][i % 6]),
        'accounts:used_quota_in_mb': String([31453, 1, 19298, 18756, 3539, 641][i % 6]),
      })),
    );
  }

  // Customer usage report: long format (date,name,value), one row per parameter.
  // Total = 100 GB pool; used matches the sum of the per-user report above.
  if (args[0] === 'report' && args[1] === 'customer') {
    const date = '2026-06-30';
    return toCsv([
      { date, name: 'accounts:total_quota_in_mb', value: '102400' },
      { date, name: 'accounts:used_quota_in_mb', value: '73688' },
      { date, name: 'accounts:num_users', value: String(USERS.length) },
    ]);
  }

  if (args[0] === 'user') {
    const email = args[1];
    seedUser(email);
    const files = filesByUser.get(email)!;
    const rest = args.slice(2).join(' ');

    const mail = mockMailCommand(email, args, rest);
    if (mail !== null) return mail;

    if (rest.startsWith('check serviceaccount')) {
      return (
        [
          `System time status`,
          `  Your system time differs from admin.googleapis.com by less than 1 second  PASS`,
          `Service Account Private Key Authentication`,
          `  Authentication      PASS`,
          `Domain-wide Delegation authentication:, User: ${email}, Scopes: 30`,
          `  https://www.googleapis.com/auth/drive  PASS (1/30)`,
          `All scopes passed!`,
        ].join('\n') + '\n'
      );
    }

    if (rest.startsWith('print filelist')) {
      return toCsv(
        files.map((f) => ({
          Owner: f.owner ?? email,
          id: f.id,
          name: f.name,
          mimeType: f.mimeType,
          size: f.size,
          parents: f.parents,
          modifiedTime: f.modifiedTime,
          webViewLink: f.webViewLink,
        })),
      );
    }

    if (rest.startsWith('print drivefileacls') || rest.startsWith('show drivefileacls')) {
      const fileId = args[4];
      const acls = aclsByFile.get(fileId) ?? [];
      return toCsv(
        acls.map((a) => ({
          Owner: email,
          id: fileId,
          'permission.id': a.id,
          'permission.type': a.type,
          'permission.emailAddress': a.emailAddress,
          'permission.role': a.role,
        })),
      );
    }

    if (rest.startsWith('add drivefileacl')) {
      const fileId = args[4];
      const shareEmail = args[6];
      const role = args[8] ?? 'reader';
      const acls = aclsByFile.get(fileId) ?? [];
      acls.push({ id: `acl_${Date.now()}`, type: 'user', emailAddress: shareEmail, role });
      aclsByFile.set(fileId, acls);
      return `Added ACL for ${shareEmail} on ${fileId}\n`;
    }

    if (rest.startsWith('update drivefileacl')) {
      const fileId = args[4];
      const who = args[5];
      const role = args[7] ?? 'reader';
      const acls = aclsByFile.get(fileId) ?? [];
      for (const a of acls) if (a.emailAddress === who || a.id === who) a.role = role;
      return `Updated ACL ${who} on ${fileId} to ${role}\n`;
    }

    if (rest.startsWith('delete drivefileacl')) {
      const fileId = args[4];
      const who = args[5];
      aclsByFile.set(
        fileId,
        (aclsByFile.get(fileId) ?? []).filter((a) => a.emailAddress !== who && a.id !== who),
      );
      return `Deleted ACL ${who} from ${fileId}\n`;
    }

    if (rest.startsWith('copy drivefile')) {
      const fileId = args[4];
      const src = files.find((f) => f.id === fileId);
      if (!src) throw new Error(`Mock: file ${fileId} not found`);
      const copy = { ...src, id: `${src.id}_copy${Date.now()}`, name: `Copy of ${src.name}` };
      files.push(copy);
      aclsByFile.set(copy.id, [{ id: 'acl_owner', type: 'user', emailAddress: email, role: 'owner' }]);
      return `Copied ${src.name} to ${copy.name} (${copy.id})\n`;
    }

    if (rest.startsWith('update drivefile') && rest.includes('parentid')) {
      const fileId = args[4];
      const parentId = args[args.indexOf('parentid') + 1];
      // the file may live in another user's tree (e.g. just-transferred items)
      const f = files.find((x) => x.id === fileId) ?? [...filesByUser.values()].flat().find((x) => x.id === fileId);
      if (!f) throw new Error(`Mock: file ${fileId} not found`);
      f.parents = parentId === 'root' ? '' : parentId;
      return `Moved ${f.name} to ${parentId}\n`;
    }
  }

  throw new Error(`Mock GAM does not implement: gam ${joined}`);
}

/** Recursively collect a folder subtree (folder itself + descendants). */
export function mockSubtree(email: string, folderId: string): MockFile[] {
  seedUser(email);
  const files = filesByUser.get(email)!;
  const result: MockFile[] = [];
  const walk = (id: string) => {
    const self = files.find((f) => f.id === id);
    if (self) result.push(self);
    for (const f of files.filter((f) => f.parents === id)) {
      if (f.mimeType === FOLDER) walk(f.id);
      else result.push(f);
    }
  };
  walk(folderId);
  return result;
}

export async function stream(
  rawArgs: string[],
  onLine: (line: string, stream: 'stdout' | 'stderr') => void,
): Promise<{ handle: StreamHandle; done: Promise<number> }> {
  const args = stripConfig(rawArgs);
  let cancelled = false;
  const handle: StreamHandle = {
    child: null,
    cancel() {
      cancelled = true;
    },
  };
  const done = (async (): Promise<number> => {
    // Mock raw export: `user X export messages ids a,b,c targetfolder DIR` writes Msg-<id>.eml files.
    // The first fetch of each mailbox's msg3 fails, like a transient Gmail 503, to exercise the retry.
    if (args[0] === 'user' && args[2] === 'export' && args[3] === 'messages') {
      const email = args[1];
      const ids = args[args.indexOf('ids') + 1].split(',');
      const dir = args[args.indexOf('targetfolder') + 1];
      const byId = new Map(seedMail(email).map((m) => [m.id, m]));
      const { writeFileSync: wf, mkdirSync: mkd } = await import('node:fs');
      const { join } = await import('node:path');
      mkd(dir, { recursive: true });
      onLine(`User: ${email}, Export ${ids.length} Messages`, 'stdout');
      let failed = false;
      for (const id of ids) {
        if (cancelled) return 130;
        await delay(40);
        const m = byId.get(id);
        const flaky = id.endsWith('_msg3') && !flakyServed.has(email);
        if (!m || flaky) {
          if (flaky) flakyServed.add(email);
          failed = true;
          onLine(
            `User: ${email}, Message: ${id}, Get Failed: ${m ? 'Service unavailable (503)' : 'Not Found'}`,
            'stderr',
          );
          continue;
        }
        const p = join(dir, `Msg-${id}.eml`);
        wf(p, mockEml(email, m));
        onLine(`  Message: ${p}, Downloaded`, 'stdout');
      }
      return failed ? 50 : 0;
    }

    // Mock mailbox export: stream the CSV line by line like real GAM does.
    if (args[0] === 'user' && args.includes('print') && args.includes('messages')) {
      const email = args[1];
      const csv = await run(args.filter((a) => a !== 'convertcrnl'));
      onLine(`Getting all Messages for ${email}`, 'stderr');
      for (const line of csv.split('\n')) {
        if (cancelled) return 130;
        if (line.trim()) onLine(line, 'stdout');
        await delay(50);
      }
      onLine(`Got ${csv.trim().split('\n').length - 1} Messages for ${email}`, 'stderr');
      return 0;
    }
    // Mock ownership transfer: emit one progress line per affected file.
    // `gam user <new> claim ownership <id>` vs `gam user <old> transfer ownership <id> <new>`
    if (args[0] === 'user' && (args.includes('claim') || args.includes('transfer'))) {
      const ownershipIdx = args.indexOf('ownership');
      const fileId = args[ownershipIdx + 1];
      const isTransfer = args.includes('transfer');
      const newOwner = isTransfer ? args[ownershipIdx + 2] : args[1];
      if (!newOwner || !newOwner.includes('@')) {
        onLine(`ERROR: no target user in: gam ${args.join(' ')}`, 'stderr');
        return 1;
      }
      // The file lives in the tree of its "holder"; its effective owner may differ.
      const holderEntry = [...filesByUser.entries()].find(([, fs]) => fs.some((f) => f.id === fileId));
      if (!holderEntry) {
        onLine(`ERROR: file ${fileId} not found`, 'stderr');
        return 1;
      }
      const holder = holderEntry[0];
      const commandUser = isTransfer ? args[1] : newOwner;
      const affected = (
        args.includes('norecursion')
          ? mockSubtree(holder, fileId).filter((f) => f.id === fileId)
          : mockSubtree(holder, fileId)
      ).filter((f) => (f.owner ?? holder) === (isTransfer ? commandUser : (f.owner ?? holder)));
      if (affected.length === 0) {
        onLine(`ERROR: ${commandUser} owns nothing in ${fileId}`, 'stderr');
        return 1;
      }
      seedUser(newOwner);
      let n = 0;
      for (const f of affected) {
        if (cancelled) {
          onLine('Cancelled.', 'stderr');
          return 130;
        }
        await delay(400);
        n += 1;
        const prevOwner = f.owner ?? holder;
        onLine(
          `User: ${prevOwner}, Transfer Ownership: ${f.name} (${f.id}), transferred to ${newOwner} (${n}/${affected.length})`,
          'stdout',
        );
        if (holder === newOwner) {
          f.owner = undefined; // already in the target's tree — just becomes theirs
        } else if (f.owner && f.owner !== holder) {
          f.owner = newOwner; // stays in the holder's tree, new owner recorded
        } else {
          // owned by the holder: move it into the target's tree
          filesByUser.set(
            holder,
            filesByUser.get(holder)!.filter((x) => x.id !== f.id),
          );
          const dest = filesByUser.get(newOwner)!;
          dest.push({ ...f, owner: undefined, parents: affected.some((p) => p.id === f.parents) ? f.parents : '' });
        }
        const acls = aclsByFile.get(f.id) ?? [];
        aclsByFile.set(f.id, [
          { id: 'acl_owner', type: 'user', emailAddress: newOwner, role: 'owner' },
          ...acls.filter((a) => a.role !== 'owner'),
        ]);
      }
      return 0;
    }
    onLine(`Mock GAM does not implement streaming: gam ${args.join(' ')}`, 'stderr');
    return 1;
  })();
  return { handle, done };
}
