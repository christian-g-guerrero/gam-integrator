import { useMemo, useState } from 'react';
import { Alert, Badge, Button, Checkbox, Code, Group, Select, Stack, Table, Text, Tooltip } from '@mantine/core';
import { IconAlertTriangle, IconTrash } from '@tabler/icons-react';
import { post, type ExportEntry, type LocalStorageUsage } from '../api';
import { fmtDate, fmtDay, fmtSize, plural } from '../lib/format';
import { sortRows, type Sort } from '../lib/table';
import { useApi } from '../lib/useApi';
import {
  ACCENT_BG,
  ConfirmModal,
  EmptyRow,
  ErrorAlert,
  Hint,
  ICON,
  LoadingState,
  NoValue,
  notifyError,
  notifyInfo,
  notifySuccess,
  NumTd,
} from '../ui';
import { ResizableTable, ResizableTh } from './ResizableTable';
import { SortableTh } from './SortableTh';

const DAY_MS = 24 * 60 * 60 * 1000;
const AGE_OPTIONS = [
  { value: '90', label: 'older than 90 days' },
  { value: '30', label: 'older than 30 days' },
  { value: '7', label: 'older than 7 days' },
  { value: '0', label: 'all exports' },
];

function formatLabel(e: ExportEntry): string {
  if (e.kind === 'folder') return 'Folder';
  const fmt = e.format ? e.format.toUpperCase() : null;
  if (e.kind === 'zip') return `ZIP${fmt ? ` · ${fmt}` : ''}${e.includesAttachments ? ' + attachments' : ''}`;
  return fmt ?? e.kind.toUpperCase();
}

function StatusCell({ e }: { e: ExportEntry }) {
  if (e.live)
    return (
      <Badge color="blue" variant="light">
        In Jobs
      </Badge>
    );
  if (e.kind === 'folder')
    return (
      <Badge color="gray" variant="light">
        Leftover
      </Badge>
    );
  if (e.complete === true)
    return (
      <Badge color="green" variant="light">
        Complete
      </Badge>
    );
  if (e.complete === false)
    return (
      <Badge color="orange" variant="light">
        Partial
      </Badge>
    );
  return <NoValue />;
}

/** `7de54af9-5ba9-…-48bb20a43039.zip` → `7de54af9….zip` (full name on hover). */
const shortName = (name: string) => name.replace(/^([0-9a-f]{8})[0-9a-f-]{28}/, '$1…');

const sum = (rows: ExportEntry[]) => rows.reduce((s, e) => s + e.bytes, 0);

/**
 * What the app keeps on disk (Settings). Mailbox exports are listed one per row and deleted only
 * by explicit selection — once the job that made one is gone from the Jobs page the file is only
 * reachable here or in Finder, and it may be the only copy of a deleted account's mail.
 */
export function LocalData() {
  const { data, error, reload } = useApi<LocalStorageUsage>('/api/storage');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [age, setAge] = useState('90');
  const [sort, setSort] = useState<Sort | null>({ key: 'created', dir: -1 });
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  const files = useMemo(() => data?.exports.files ?? [], [data]);
  const rows = useMemo(
    () => sortRows(files, sort, (e, k) => (k === 'mailbox' ? (e.mailbox ?? '') : k === 'size' ? e.bytes : e.mtime)),
    [files, sort],
  );
  const deletable = files.filter((e) => !e.live);
  const chosen = files.filter((e) => selected.has(e.name) && !e.live);
  const allSelected = deletable.length > 0 && chosen.length === deletable.length;

  const toggle = (name: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });

  function selectByAge() {
    const cutoff = Date.now() - Number(age) * DAY_MS;
    const match = deletable.filter((e) => age === '0' || e.mtime < cutoff);
    setSelected(new Set(match.map((e) => e.name)));
    if (match.length === 0) notifyInfo(`No exports ${AGE_OPTIONS.find((o) => o.value === age)?.label}.`);
  }

  async function remove() {
    setBusy(true);
    try {
      const r = await post<{ deleted: string[]; bytes: number }>('/api/storage/exports/delete', {
        names: chosen.map((e) => e.name),
      });
      notifySuccess(`Deleted ${plural(r.deleted.length, 'export')} and freed ${fmtSize(r.bytes)}.`);
      setSelected(new Set());
      setConfirming(false);
      reload();
    } catch (e) {
      notifyError('Could not delete exports', e);
    } finally {
      setBusy(false);
    }
  }

  // Rendered inside Settings' "Local data" <Section>, which supplies the card and heading.
  return (
    <>
      <Stack gap="md">
        {error && <ErrorAlert title="Could not load local data">{error}</ErrorAlert>}
        {!data && !error && <LoadingState label="Loading local data…" />}
        {data && (
          <>
            <div>
              <Group justify="space-between" align="baseline">
                <Text size="sm" fw={600}>
                  Mailbox exports
                </Text>
                <Text size="sm">
                  {files.length === 0 ? 'None' : `${plural(files.length, 'export')} · ${fmtSize(sum(files))} total`}
                </Text>
              </Group>
              <Hint>
                Saved in <Code>{data.exports.path}</Code>. Never deleted automatically. After a server restart they're
                no longer listed under Jobs, but the files stay here.
              </Hint>
            </div>

            <Group gap="xs" align="end" justify="space-between">
              <Group gap="xs" align="end">
                <Select
                  label="Select exports"
                  data={AGE_OPTIONS}
                  value={age}
                  onChange={(v) => v && setAge(v)}
                  allowDeselect={false}
                  w={200}
                />
                <Button variant="light" onClick={selectByAge} disabled={deletable.length === 0}>
                  Select
                </Button>
                {chosen.length > 0 && (
                  <Button variant="subtle" color="gray" onClick={() => setSelected(new Set())}>
                    Clear
                  </Button>
                )}
              </Group>
              <Button
                color="red"
                variant="light"
                leftSection={<IconTrash size={ICON.md} aria-hidden />}
                disabled={chosen.length === 0}
                onClick={() => setConfirming(true)}
              >
                Delete selected{chosen.length > 0 ? ` (${chosen.length} · ${fmtSize(sum(chosen))})` : ''}
              </Button>
            </Group>

            <ResizableTable storageKey="local-exports" highlightOnHover withTableBorder>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th w={36}>
                    <Checkbox
                      size="sm"
                      checked={allSelected}
                      indeterminate={chosen.length > 0 && !allSelected}
                      disabled={deletable.length === 0}
                      onChange={() => setSelected(allSelected ? new Set() : new Set(deletable.map((e) => e.name)))}
                      aria-label="Select all exports"
                    />
                  </Table.Th>
                  <SortableTh label="Mailbox" k="mailbox" sort={sort} setSort={setSort} />
                  <ResizableTh k="format">Format</ResizableTh>
                  <ResizableTh k="status">Status</ResizableTh>
                  <SortableTh label="Size" k="size" sort={sort} setSort={setSort} defaultDir={-1} numeric />
                  <SortableTh label="Created" k="created" sort={sort} setSort={setSort} defaultDir={-1} />
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {rows.map((e) => (
                  <Table.Tr key={e.name} bg={selected.has(e.name) && !e.live ? ACCENT_BG : undefined}>
                    <Table.Td>
                      <Checkbox
                        size="sm"
                        checked={selected.has(e.name) && !e.live}
                        disabled={e.live}
                        onChange={() => toggle(e.name)}
                        aria-label={`Select ${e.mailbox ?? e.name}`}
                      />
                    </Table.Td>
                    <Table.Td>
                      <Text size="sm">
                        {e.mailbox ?? (
                          <Text span size="sm" c="dimmed">
                            Unknown
                          </Text>
                        )}
                      </Text>
                      <Tooltip label={e.name}>
                        <Text size="xs" c="dimmed" ff="monospace" w="fit-content">
                          {shortName(e.name)}
                        </Text>
                      </Tooltip>
                    </Table.Td>
                    <Table.Td>
                      <Text size="sm">{formatLabel(e)}</Text>
                    </Table.Td>
                    <Table.Td>
                      <StatusCell e={e} />
                    </Table.Td>
                    <NumTd>{fmtSize(e.bytes)}</NumTd>
                    <Table.Td>
                      <Tooltip label={fmtDate(e.mtime)}>
                        <Text size="sm" c="dimmed" w="fit-content">
                          {fmtDay(e.mtime)}
                        </Text>
                      </Tooltip>
                    </Table.Td>
                  </Table.Tr>
                ))}
                {rows.length === 0 && <EmptyRow colSpan={6} message="No mailbox exports on disk." />}
              </Table.Tbody>
            </ResizableTable>
            <Hint>
              “In Jobs” exports are still downloadable from the Jobs page and can't be deleted here. “Leftover” folders
              are what an interrupted export left behind.
            </Hint>

            <div>
              <Text size="sm" fw={600}>
                Job logs
              </Text>
              <Text size="sm">
                {data.jobLogs.entries === 0
                  ? 'No job logs.'
                  : `${plural(data.jobLogs.entries, 'log')} · ${fmtSize(data.jobLogs.bytes)}${data.jobLogs.oldest ? ` · oldest ${fmtDay(data.jobLogs.oldest)}` : ''}`}
              </Text>
              <Hint>Diagnostics only. Deleted automatically after {data.jobLogs.retentionDays} days.</Hint>
            </div>
          </>
        )}
      </Stack>

      <ConfirmModal
        opened={confirming}
        onClose={() => setConfirming(false)}
        onConfirm={() => void remove()}
        title="Delete mailbox exports?"
        confirmLabel={`Delete ${plural(chosen.length, 'export')}`}
        loading={busy}
      >
        <Text size="sm">
          This permanently deletes {plural(chosen.length, 'export')} ({fmtSize(sum(chosen))}) from this computer.
        </Text>
        <Alert color="red" icon={<IconAlertTriangle size={ICON.md} aria-hidden />}>
          If an export is the only copy of a deleted account's mail, it can't be recovered.
        </Alert>
      </ConfirmModal>
    </>
  );
}
