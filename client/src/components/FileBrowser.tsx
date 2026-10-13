import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActionIcon,
  Anchor,
  Badge,
  Box,
  Breadcrumbs,
  Checkbox,
  Group,
  SegmentedControl,
  Select,
  Table,
  Text,
  TextInput,
  Tooltip,
  VisuallyHidden,
} from '@mantine/core';
import { IconExternalLink, IconFile, IconFolder, IconRefresh, IconSearch } from '@tabler/icons-react';
import { api, DriveFile, endpoints } from '../api';
import { fmtDay, fmtSize, mimeLabel, plural } from '../lib/format';
import { Sort, sortRows } from '../lib/table';
import { ACCENT_BG, EmptyRow, ErrorAlert, ICON, LoadingState, NoValue, NumTd, TEXT } from '../ui';
import { ResizableTable, ResizableTh } from './ResizableTable';
import { SortableTh } from './SortableTh';

interface FileBrowserProps {
  /** Whose Drive is being browsed. */
  owner: string;
  /** Extra cells/menus rendered at the end of each row. */
  renderActions?: (file: DriveFile, refresh: () => void) => React.ReactNode;
  /** Bump to force a reload from outside (e.g. after a mutation). */
  reloadKey?: number;
  /** When provided, rows get checkboxes and selection is reported upward. */
  selection?: Set<string>;
  onSelectionChange?: (ids: Set<string>) => void;
  /** Reports the loaded file list upward (for bulk actions on selected ids). */
  onFilesLoaded?: (files: DriveFile[]) => void;
}

/**
 * View over a user's flat filelist: folder navigation ("Browse") or a flat
 * recursive listing of every file ("All files" — sorted by size by default,
 * i.e. a largest-files finder). "Root" = files whose parent id is not itself
 * in the list (covers real Drive root ids and mock's empty parent).
 */
export function FileBrowser({
  owner,
  renderActions,
  reloadKey = 0,
  selection,
  onSelectionChange,
  onFilesLoaded,
}: FileBrowserProps) {
  const [files, setFiles] = useState<DriveFile[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [crumbs, setCrumbs] = useState<{ id: string; name: string }[]>([]);
  const [query, setQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<'folder' | 'all'>('folder');
  const [sort, setSort] = useState<Sort | null>(null);
  const [nonce, setNonce] = useState(0);
  // External reloadKey and the internal refresh button feed one reload tick.
  const reloadTick = reloadKey + nonce;

  useEffect(() => {
    setFiles(null);
    setError(null);
    // Stale-response guard: switching users mid-flight must not let the slower
    // earlier response overwrite the newer one.
    let stale = false;
    api<DriveFile[]>(endpoints.userFiles(owner)).then(
      (f) => {
        if (stale) return;
        setFiles(f);
        onFilesLoaded?.(f);
      },
      (e) => {
        if (!stale) setError(e.message);
      },
    );
    return () => {
      stale = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [owner, reloadTick]);

  useEffect(() => {
    setCrumbs([]);
    setQuery('');
    setViewMode('folder');
    setSort(null);
  }, [owner]);

  // Anchor for shift+click range selection; indices change with the visible set.
  const lastCheckedIdx = useRef<number | null>(null);
  useEffect(() => {
    lastCheckedIdx.current = null;
  }, [crumbs, query, viewMode, sort, owner, typeFilter]);

  const refresh = () => setNonce((n) => n + 1);

  const byId = useMemo(() => new Map((files ?? []).map((f) => [f.id, f])), [files]);

  // Recursive folder sizes: a folder's size is the sum of everything inside it.
  const folderSizes = useMemo(() => {
    const memo = new Map<string, number>();
    if (!files) return memo;
    const byParent = new Map<string, DriveFile[]>();
    for (const f of files) {
      const l = byParent.get(f.parent) ?? [];
      l.push(f);
      byParent.set(f.parent, l);
    }
    const calc = (f: DriveFile): number => {
      if (!f.isFolder) return f.size;
      if (memo.has(f.id)) return memo.get(f.id)!;
      memo.set(f.id, 0); // cycle guard
      const total = (byParent.get(f.id) ?? []).reduce((s, c) => s + calc(c), 0);
      memo.set(f.id, total);
      return total;
    };
    for (const f of files) calc(f);
    return memo;
  }, [files]);

  const effSize = useCallback(
    (f: DriveFile): number => (f.isFolder ? (folderSizes.get(f.id) ?? 0) : f.size),
    [folderSizes],
  );

  const pathOf = (f: DriveFile): string => {
    const parts: string[] = [];
    let p = byId.get(f.parent);
    let guard = 0;
    while (p && guard++ < 25) {
      parts.unshift(p.name);
      p = byId.get(p.parent);
    }
    return parts.length ? parts.join(' / ') : 'My Drive';
  };

  const flatView = viewMode === 'all' || Boolean(query.trim());

  const view = useMemo(() => {
    if (!files) return [];
    let rows: DriveFile[];
    if (query.trim()) {
      const q = query.toLowerCase();
      rows = files.filter((f) => f.name.toLowerCase().includes(q));
    } else if (viewMode === 'all') {
      rows = files.filter((f) => !f.isFolder);
    } else if (crumbs.length) {
      rows = files.filter((f) => f.parent === crumbs[crumbs.length - 1].id);
    } else {
      const knownIds = new Set(files.map((f) => f.id));
      rows = files.filter((f) => !knownIds.has(f.parent));
    }
    if (typeFilter === 'folders') rows = rows.filter((f) => f.isFolder);
    if (typeFilter === 'files') rows = rows.filter((f) => !f.isFolder);
    if (sort) {
      return sortRows(rows, sort, (f, key) =>
        key === 'size' ? effSize(f) : key === 'modified' ? f.modifiedTime : f.name,
      );
    }
    return [...rows].sort((a, b) => Number(b.isFolder) - Number(a.isFolder) || a.name.localeCompare(b.name));
  }, [files, crumbs, query, typeFilter, viewMode, sort, effSize]);

  if (error) return <ErrorAlert title="Could not load files">{error}</ErrorAlert>;
  if (!files) return <LoadingState label="Loading files…" />;

  const selectable = Boolean(onSelectionChange);
  const columns = 5 + (flatView ? 1 : 0) + (renderActions ? 1 : 0) + (selectable ? 1 : 0);
  const allVisibleSelected = selectable && view.length > 0 && view.every((f) => selection?.has(f.id));

  /** Plain click toggles one row; shift+click applies the clicked row's new state to the whole range since the last click. */
  const toggleRow = (id: string, idx: number, shiftKey: boolean) => {
    const next = new Set(selection);
    const willSelect = !next.has(id);
    if (shiftKey && lastCheckedIdx.current !== null && lastCheckedIdx.current < view.length) {
      const [from, to] = [Math.min(lastCheckedIdx.current, idx), Math.max(lastCheckedIdx.current, idx)];
      for (let i = from; i <= to; i++) {
        if (willSelect) next.add(view[i].id);
        else next.delete(view[i].id);
      }
    } else if (willSelect) {
      next.add(id);
    } else {
      next.delete(id);
    }
    lastCheckedIdx.current = idx;
    onSelectionChange?.(next);
  };
  // The whole cell is the mouse target (the checkbox has pointer-events: none so shift-click ranges work).
  // A keyboard Space on the focused checkbox dispatches a click *on the input* — that one is the checkbox's
  // own onChange; handling it here too (with preventDefault) made the browser revert the box's checked state.
  const handleCheckCellClick = (e: React.MouseEvent, id: string, idx: number) => {
    if (e.target instanceof HTMLInputElement) return;
    e.preventDefault();
    e.stopPropagation();
    toggleRow(id, idx, e.shiftKey);
  };
  const openFolder = (f: DriveFile) => {
    setQuery('');
    setCrumbs((c) => [...c, { id: f.id, name: f.name }]);
  };
  const emptyMessage = query.trim()
    ? `No files match “${query.trim()}”.`
    : typeFilter
      ? 'Nothing here matches the type filter.'
      : viewMode === 'all'
        ? 'No files in this Drive yet.'
        : 'This folder is empty.';
  const toggleAllVisible = () => {
    const next = new Set(selection);
    if (allVisibleSelected) view.forEach((f) => next.delete(f.id));
    else view.forEach((f) => next.add(f.id));
    onSelectionChange?.(next);
  };

  return (
    <>
      <Group gap="sm" mb="xs" wrap="wrap">
        <SegmentedControl
          aria-label="View"
          value={viewMode}
          onChange={(v) => {
            setViewMode(v as 'folder' | 'all');
            // "All files" doubles as a largest-files finder — start at size ↓
            setSort(v === 'all' ? { key: 'size', dir: -1 } : null);
          }}
          data={[
            { value: 'folder', label: 'Browse' },
            { value: 'all', label: 'All files' },
          ]}
        />
        <TextInput
          aria-label="Search files"
          placeholder="Search all files by name…"
          leftSection={<IconSearch size={ICON.md} aria-hidden />}
          value={query}
          onChange={(e) => setQuery(e.currentTarget.value)}
          w={260}
        />
        <Select
          aria-label="Filter by type"
          placeholder="All types"
          data={[
            { value: 'folders', label: 'Folders only' },
            { value: 'files', label: 'Files only' },
          ]}
          value={typeFilter}
          onChange={setTypeFilter}
          clearable
          w={150}
        />
        <Tooltip label="Refresh">
          <ActionIcon variant="light" size="input-sm" onClick={refresh} aria-label="Refresh">
            <IconRefresh size={ICON.md} aria-hidden />
          </ActionIcon>
        </Tooltip>
        <Text size="sm" c="dimmed">
          {plural(files.length, 'item')} in this Drive
        </Text>
      </Group>

      {!flatView && (
        <Breadcrumbs mb="xs">
          <Anchor component="button" type="button" size="sm" onClick={() => setCrumbs([])}>
            My Drive
          </Anchor>
          {crumbs.map((c, i) => (
            <Anchor
              component="button"
              type="button"
              size="sm"
              key={c.id}
              onClick={() => setCrumbs(crumbs.slice(0, i + 1))}
            >
              {c.name}
            </Anchor>
          ))}
        </Breadcrumbs>
      )}

      <ResizableTable storageKey="files" highlightOnHover withTableBorder>
        <Table.Thead>
          <Table.Tr>
            {selectable && (
              <Table.Th w={36}>
                <Checkbox
                  size="sm"
                  checked={allVisibleSelected}
                  onChange={toggleAllVisible}
                  aria-label="Select all visible"
                />
              </Table.Th>
            )}
            <SortableTh label="Name" k="name" sort={sort} setSort={setSort} />
            {flatView && <ResizableTh k="location">Location</ResizableTh>}
            <ResizableTh k="type">Type</ResizableTh>
            <SortableTh label="Size" k="size" sort={sort} setSort={setSort} defaultDir={-1} numeric />
            <SortableTh label="Modified" k="modified" sort={sort} setSort={setSort} defaultDir={-1} />
            <Table.Th w={44}>
              <VisuallyHidden>Open in Drive</VisuallyHidden>
            </Table.Th>
            {renderActions && (
              <ResizableTh k="actions">
                <VisuallyHidden>Actions</VisuallyHidden>
              </ResizableTh>
            )}
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {view.map((f, idx) => (
            <Table.Tr key={f.id} bg={selection?.has(f.id) ? ACCENT_BG : undefined}>
              {selectable && (
                <Table.Td
                  onClick={(e) => handleCheckCellClick(e, f.id, idx)}
                  style={{ userSelect: 'none', cursor: 'pointer' }}
                >
                  <Checkbox
                    size="sm"
                    checked={selection?.has(f.id) ?? false}
                    onChange={(e) => toggleRow(f.id, idx, (e.nativeEvent as MouseEvent).shiftKey ?? false)}
                    style={{ pointerEvents: 'none' }}
                    aria-label={`Select ${f.name}`}
                  />
                </Table.Td>
              )}
              <Table.Td maw={340}>
                <Group gap="xs" wrap="nowrap">
                  {f.isFolder ? (
                    <IconFolder size={ICON.md} color="var(--icon-folder)" aria-hidden />
                  ) : (
                    <IconFile size={ICON.md} color="var(--icon-file)" aria-hidden />
                  )}
                  <Box miw={0}>
                    {f.isFolder && !flatView ? (
                      <Anchor
                        component="button"
                        type="button"
                        size="sm"
                        fw={600}
                        ta="left"
                        display="block"
                        maw="100%"
                        truncate
                        onClick={() => openFolder(f)}
                      >
                        {f.name}
                      </Anchor>
                    ) : (
                      <Text size="sm" truncate fw={f.isFolder ? 600 : undefined}>
                        {f.name}
                      </Text>
                    )}
                    {f.owner !== owner && (
                      <Text size="xs" c={TEXT.warning} truncate>
                        Owned by {f.owner}
                      </Text>
                    )}
                  </Box>
                </Group>
              </Table.Td>
              {flatView && (
                <Table.Td maw={220}>
                  <Text size="xs" c="dimmed" truncate>
                    {pathOf(f)}
                  </Text>
                </Table.Td>
              )}
              <Table.Td>
                <Badge variant="light" color={f.isFolder ? 'yellow' : 'blue'}>
                  {mimeLabel(f.mimeType)}
                </Badge>
              </Table.Td>
              <NumTd>
                {f.isFolder ? (
                  <Tooltip label="Total size of everything inside this folder">
                    <Text span size="sm" c="dimmed">
                      {fmtSize(effSize(f))}
                    </Text>
                  </Tooltip>
                ) : f.size ? (
                  fmtSize(f.size)
                ) : (
                  <NoValue />
                )}
              </NumTd>
              <Table.Td>
                <Text size="sm" c="dimmed">
                  {fmtDay(f.modifiedTime)}
                </Text>
              </Table.Td>
              <Table.Td>
                {f.webViewLink && (
                  <Tooltip label="Open in Google Drive">
                    <ActionIcon
                      component="a"
                      href={f.webViewLink}
                      target="_blank"
                      rel="noreferrer"
                      variant="subtle"
                      aria-label={`Open ${f.name} in Drive`}
                    >
                      <IconExternalLink size={ICON.md} aria-hidden />
                    </ActionIcon>
                  </Tooltip>
                )}
              </Table.Td>
              {renderActions && <Table.Td>{renderActions(f, refresh)}</Table.Td>}
            </Table.Tr>
          ))}
          {view.length === 0 && <EmptyRow colSpan={columns} message={emptyMessage} />}
        </Table.Tbody>
      </ResizableTable>
    </>
  );
}
