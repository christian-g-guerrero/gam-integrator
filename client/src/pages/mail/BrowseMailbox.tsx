import { useEffect, useMemo, useState } from 'react';
import { Box, Button, Card, Checkbox, Group, Menu, NavLink, Select, Stack, Text, TextInput } from '@mantine/core';
import { useNavigate } from 'react-router-dom';
import { IconDownload, IconSearch } from '@tabler/icons-react';
import {
  api,
  endpoints,
  GmailProfile,
  LargeMailBucket,
  LargeMailResult,
  MailLabel,
  MailMessage,
  post,
} from '../../api';
import { UserSelect } from '../../components/UserSelect';
import { fmtSize, plural } from '../../lib/format';
import {
  ACTION_COLORS,
  EmptyState,
  ErrorAlert,
  Hint,
  ICON,
  LoadingState,
  notifyError,
  notifySuccess,
  TEXT,
} from '../../ui';
import { labelName, SYSTEM_ORDER } from './labels';
import { MessageTable } from './MessageTable';

/** Pseudo-label for the unscoped listing — the Gmail API has no All Mail label. */
const ALL_MAIL = '__ALL_MAIL__';
const HIDDEN_LABELS = new Set(['UNREAD', 'CHAT']);

/** Horizontal bar-per-bucket breakdown of where mailbox size is concentrated. */
function SizeHistogram({ buckets }: { buckets: LargeMailBucket[] }) {
  const active = buckets.filter((b) => b.count > 0);
  if (active.length === 0) return null;
  const max = Math.max(...active.map((b) => b.bytes));
  return (
    <Stack gap={4} maw={560}>
      {active.map((b) => (
        <Group key={b.label} gap="xs" wrap="nowrap">
          <Text size="xs" c="dimmed" w={82} ta="right">
            {b.label}
          </Text>
          {/* Role tokens (App.css): skins repoint --chart-track / --chart-bar. */}
          <Box
            flex={1}
            h={14}
            bg="var(--chart-track)"
            style={{ borderRadius: 'var(--mantine-radius-sm)', overflow: 'hidden' }}
            aria-hidden
          >
            <Box h="100%" w={`${(b.bytes / max) * 100}%`} bg="var(--chart-bar)" />
          </Box>
          <Text size="xs" w={130} className="gam-num">
            {b.count.toLocaleString()} · {fmtSize(b.bytes)}
          </Text>
        </Group>
      ))}
    </Stack>
  );
}

interface BrowseMailboxProps {
  /** Pre-select a mailbox when arriving from another page (e.g. Drive's "View mailbox"). */
  initialEmail?: string | null;
  onOpen: (user: string, id: string) => void;
}

export function BrowseMailbox({ initialEmail, onOpen }: BrowseMailboxProps) {
  const [email, setEmail] = useState<string | null>(initialEmail ?? null);
  const [labels, setLabels] = useState<MailLabel[] | null>(null);
  const [labelsError, setLabelsError] = useState<string | null>(null);
  const [profile, setProfile] = useState<GmailProfile | null>(null);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [activeLabel, setActiveLabel] = useState<string>('INBOX');
  const [query, setQuery] = useState('');
  const [appliedQuery, setAppliedQuery] = useState('');
  const [messages, setMessages] = useState<MailMessage[] | null>(null);
  const [messagesError, setMessagesError] = useState<string | null>(null);
  const [minSize, setMinSize] = useState<string | null>(null); // e.g. '5' = larger:5M
  const [largeMail, setLargeMail] = useState<LargeMailResult | null>(null);
  const [exporting, setExporting] = useState(false);
  const [includeSpamTrash, setIncludeSpamTrash] = useState(false);
  const navigate = useNavigate();

  async function exportMailbox(format: 'csv' | 'jsonl', includeAttachments = false) {
    setExporting(true);
    try {
      const { jobId } = await post<{ jobId: string }>(endpoints.mailExport(email!), {
        format,
        includeAttachments,
        includeSpamTrash,
      });
      notifySuccess('Follow progress on the job page.', 'Export started');
      void navigate(`/jobs/${jobId}`);
    } catch (e) {
      notifyError('Could not start export', e);
    } finally {
      setExporting(false);
    }
  }

  useEffect(() => {
    setLabels(null);
    setLabelsError(null);
    setProfile(null);
    setProfileError(null);
    setMessages(null);
    setLargeMail(null);
    setActiveLabel('INBOX');
    setQuery('');
    setAppliedQuery('');
    setMinSize(null);
    if (!email) return;
    // Stale-response guard: switching mailboxes quickly must not show the previous mailbox's labels.
    let stale = false;
    api<MailLabel[]>(endpoints.mailLabels(email)).then(
      (l) => {
        if (!stale) setLabels(l);
      },
      (e: Error) => {
        if (!stale) setLabelsError(e.message);
      },
    );
    // Profile total is the source of truth for "All Mail" — label counts can't add up to it.
    api<GmailProfile>(endpoints.mailProfile(email)).then(
      (p) => {
        if (!stale) setProfile(p);
      },
      (e: Error) => {
        if (!stale) setProfileError(e.message);
      },
    );
    return () => {
      stale = true;
    };
  }, [email]);

  useEffect(() => {
    if (!email) return;
    // Stale-response guard: clicking labels quickly must not let a slower
    // earlier response overwrite the latest one.
    let stale = false;
    setMessages(null);
    setMessagesError(null);
    setLargeMail(null);
    // A failed load is shown as an error, never as an empty "No messages." list.
    const fail = (e: Error) => {
      if (!stale) setMessagesError(e.message);
    };
    if (minSize) {
      // Full scan (GAM max_to_print 0) — exact count/total, not just a first page.
      api<LargeMailResult>(endpoints.mailLargeMail(email, minSize)).then((r) => {
        if (stale) return;
        setLargeMail(r);
        setMessages(r.messages);
      }, fail);
    } else {
      const params = new URLSearchParams();
      if (appliedQuery) params.set('q', appliedQuery);
      // All Mail = unscoped listing (everything except Spam/Trash) — no label filter.
      else if (activeLabel !== ALL_MAIL) params.set('labelId', activeLabel);
      params.set('max', '50');
      api<MailMessage[]>(endpoints.mailMessages(email, params)).then((m) => {
        if (!stale) setMessages(m);
      }, fail);
    }
    return () => {
      stale = true;
    };
  }, [email, activeLabel, appliedQuery, minSize]);

  // The three filters are mutually exclusive (size filter scans the whole
  // mailbox, ignoring label and query) — picking one clears the others so the
  // list always matches what looks selected.
  const applySearch = (q: string) => {
    setAppliedQuery(q);
    if (q) setMinSize(null);
  };
  const applyMinSize = (v: string | null) => {
    setMinSize(v);
    if (v) {
      setQuery('');
      setAppliedQuery('');
    }
  };
  const openLabel = (id: string) => {
    setAppliedQuery('');
    setQuery('');
    setMinSize(null);
    setActiveLabel(id);
  };

  const sortedLabels = useMemo(() => {
    if (!labels) return [];
    const visible = labels.filter((l) => !HIDDEN_LABELS.has(l.name) && !l.name.startsWith('CATEGORY_'));
    return visible.sort((a, b) => {
      const ai = SYSTEM_ORDER.indexOf(a.name);
      const bi = SYSTEM_ORDER.indexOf(b.name);
      if (ai !== -1 || bi !== -1) return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
      return a.name.localeCompare(b.name);
    });
  }, [labels]);

  // All Mail + the visible labels with their counts — the one list both label pickers (the sidebar on
  // wide screens, the dropdown on narrow ones) render.
  const labelItems = useMemo(
    () => [
      {
        id: ALL_MAIL,
        name: 'All Mail',
        count: profile ? profile.messagesTotal.toLocaleString() : profileError ? '—' : '…',
      },
      ...sortedLabels.map((l) => ({
        id: l.id,
        name: labelName(l.name, l.type === 'system'),
        count: `${l.messagesUnread > 0 ? `${l.messagesUnread}/` : ''}${l.messagesTotal}`,
      })),
    ],
    [sortedLabels, profile, profileError],
  );
  const countById = useMemo(() => new Map(labelItems.map((l) => [l.id, l.count])), [labelItems]);
  // While a search or size scan is showing, no label is the filter — so none looks selected.
  const shownLabel = appliedQuery || minSize ? null : activeLabel;

  const labelNotes = (
    <>
      {profileError && <Hint c={TEXT.danger}>Could not load the mailbox total: {profileError}</Hint>}
      <Hint>
        All Mail is the Gmail profile total, incl. Spam &amp; Trash. Archived mail (no Inbox label) only shows up in All
        Mail.
      </Hint>
    </>
  );

  return (
    <Stack gap="sm">
      {/* Row 1 — which mailbox, and what to do with all of it. */}
      <Group align="flex-end" justify="space-between" gap="sm">
        <UserSelect label="Mailbox" value={email} onChange={setEmail} w={340} maw="100%" />
        {email && (
          <Menu width={340} styles={{ dropdown: { maxWidth: 'calc(100vw - 2rem)' } }}>
            <Menu.Target>
              <Button
                variant="light"
                color={ACTION_COLORS.export}
                leftSection={<IconDownload size={ICON.md} aria-hidden />}
                loading={exporting}
              >
                Export mailbox
              </Button>
            </Menu.Target>
            <Menu.Dropdown>
              {/* The option comes first: it applies to whichever format is picked below. */}
              <Group px="sm" pt="xs" wrap="nowrap" onClick={(e) => e.stopPropagation()}>
                <Checkbox
                  size="xs"
                  label="Include Spam & Trash"
                  checked={includeSpamTrash}
                  onChange={(e) => setIncludeSpamTrash(e.currentTarget.checked)}
                />
              </Group>
              <Hint px="sm" pt={4} pb="xs">
                Off by default (matches Gmail search) — every format below skips Spam and Trash unless checked.
              </Hint>
              <Menu.Divider />
              <Menu.Label>Messages only (small)</Menu.Label>
              <Menu.Item onClick={() => exportMailbox('jsonl')}>
                <Text size="sm" fw={600}>
                  JSONL archive (ZIP) — recommended
                </Text>
                <Hint>
                  Lossless, one JSON object per message: exact text + HTML bodies, Message-ID/threading headers, labels,
                  attachment metadata with SHA-256, plus a manifest.json for verifying completeness. Best for archives,
                  CRM import, RAG.
                </Hint>
              </Menu.Item>
              <Menu.Item onClick={() => exportMailbox('csv')}>
                <Text size="sm" fw={600}>
                  CSV
                </Text>
                <Hint>
                  Spreadsheet-friendly (Excel / Sheets), one row per message. Line breaks are flattened to \n — use
                  JSONL for an exact archive.
                </Hint>
              </Menu.Item>
              <Menu.Label>With attachments (can be many GB)</Menu.Label>
              <Menu.Item onClick={() => exportMailbox('jsonl', true)}>
                <Text size="sm" fw={600}>
                  JSONL + attachments (ZIP)
                </Text>
                <Hint>
                  The archive plus every attachment file, filed under attachments/&lt;message id&gt;/ and linked from
                  each message.
                </Hint>
              </Menu.Item>
              <Menu.Item onClick={() => exportMailbox('csv', true)}>
                <Text size="sm" fw={600}>
                  CSV + attachments (ZIP)
                </Text>
                <Hint>Spreadsheet format, with attachments.csv mapping each file to its message.</Hint>
              </Menu.Item>
            </Menu.Dropdown>
          </Menu>
        )}
      </Group>

      {/* Row 2 — what to show: a search, a label (a dropdown below lg; the sidebar replaces it above), or a
          size scan. Labels stay one line so the fields line up at every width; the syntax example is the
          placeholder. */}
      {email && (
        <Group align="flex-end" gap="sm">
          <Group align="flex-end" gap="xs" wrap="nowrap" flex={1} miw={260}>
            <TextInput
              label="Search (Gmail syntax)"
              placeholder="from:bob subject:invoice after:2026/01/01"
              value={query}
              onChange={(e) => setQuery(e.currentTarget.value)}
              onKeyDown={(e) => e.key === 'Enter' && applySearch(query)}
              flex={1}
              miw={0}
            />
            <Button leftSection={<IconSearch size={ICON.md} aria-hidden />} onClick={() => applySearch(query)}>
              Search
            </Button>
            {appliedQuery && (
              <Button
                variant="subtle"
                color="gray"
                onClick={() => {
                  setQuery('');
                  setAppliedQuery('');
                }}
              >
                Clear
              </Button>
            )}
          </Group>
          <Group align="flex-end" gap="sm" wrap="nowrap">
            <Select
              label="Label"
              hiddenFrom="lg"
              w={170}
              data={labelItems.map((l) => ({ value: l.id, label: l.name }))}
              value={shownLabel}
              onChange={(v) => v && openLabel(v)}
              allowDeselect={false}
              disabled={!labels}
              placeholder={labelsError ? 'Unavailable' : labels ? 'Pick a label…' : 'Loading…'}
              comboboxProps={{ width: 240, position: 'bottom-start' }}
              renderOption={({ option }) => (
                <Group justify="space-between" wrap="nowrap" w="100%">
                  <Text size="sm" truncate>
                    {option.label}
                  </Text>
                  <Text size="xs" c="dimmed">
                    {countById.get(option.value)}
                  </Text>
                </Group>
              )}
            />
            <Select
              label="Large emails"
              placeholder="All sizes"
              data={[
                { value: '100', label: '≥ 100 MB' },
                { value: '50', label: '≥ 50 MB' },
                { value: '25', label: '≥ 25 MB' },
                { value: '10', label: '≥ 10 MB' },
                { value: '5', label: '≥ 5 MB' },
                { value: '1', label: '≥ 1 MB' },
              ]}
              value={minSize}
              onChange={applyMinSize}
              clearable
              w={130}
            />
          </Group>
        </Group>
      )}
      {email && minSize && largeMail && (
        <Stack gap="xs">
          <Text size="sm" c="dimmed">
            <b>{plural(largeMail.count, 'message')}</b> ≥ {minSize} MB — combined <b>{fmtSize(largeMail.totalBytes)}</b>{' '}
            (exact count from a full mailbox scan, not just a first page). Sizes include attachments; delete or download
            the top offenders to reclaim Gmail storage.
          </Text>
          <SizeHistogram buckets={largeMail.buckets} />
        </Stack>
      )}

      {email && (
        <Group align="flex-start" gap="md" wrap="nowrap">
          <Card padding="xs" w={230} visibleFrom="lg" style={{ flexShrink: 0 }}>
            {labelsError ? (
              <ErrorAlert title="Could not load labels">{labelsError}</ErrorAlert>
            ) : !labels ? (
              <LoadingState label="Loading labels…" />
            ) : (
              <Stack gap={4}>
                {labelItems.map((l) => (
                  // A button, not Mantine's default <a>: picking a label filters in place, it goes nowhere.
                  <NavLink
                    key={l.id}
                    component="button"
                    type="button"
                    label={
                      <Group justify="space-between" wrap="nowrap">
                        <Text size="sm" truncate>
                          {l.name}
                        </Text>
                        {/* On the selected row the count takes the row's accent text color: dimmed grey
                            on the accent tint is under AA in dark mode. */}
                        <Text size="xs" c={shownLabel === l.id ? 'inherit' : 'dimmed'}>
                          {l.count}
                        </Text>
                      </Group>
                    }
                    active={shownLabel === l.id}
                    onClick={() => openLabel(l.id)}
                  />
                ))}
                <Stack gap="xs" px="xs" pt="xs">
                  {labelNotes}
                </Stack>
              </Stack>
            )}
          </Card>
          <Stack gap="xs" flex={1} miw={0}>
            {labelsError && (
              <Box hiddenFrom="lg">
                <ErrorAlert title="Could not load labels">{labelsError}</ErrorAlert>
              </Box>
            )}
            {messagesError ? (
              <ErrorAlert title="Could not load messages">{messagesError}</ErrorAlert>
            ) : !messages ? (
              <LoadingState label="Loading messages…" />
            ) : (
              <>
                {appliedQuery && !minSize && (
                  <Text size="sm" c="dimmed">
                    Results for “{appliedQuery}” (up to 50)
                  </Text>
                )}
                <MessageTable rows={messages} showSize={Boolean(minSize)} onOpen={onOpen} />
              </>
            )}
            {labels && (
              <Stack gap="xs" hiddenFrom="lg">
                {labelNotes}
              </Stack>
            )}
          </Stack>
        </Group>
      )}
      {!email && <EmptyState message="Pick a user to open their mailbox." />}
    </Stack>
  );
}
