import { useEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Anchor, Loader, Table, Text, TextInput, Tooltip } from '@mantine/core';
import { IconSearch } from '@tabler/icons-react';
import { api, endpoints, routes, UserStats, WorkspaceUser, withRefresh } from '../api';
import { fmtDate, fmtSize, plural } from '../lib/format';
import { Sort, sortRows } from '../lib/table';
import { CACHE_KEYS, getCached, setCached } from '../lib/pageCache';
import { useUsers } from '../lib/useUsers';
import { ResizableTable, ResizableTh } from '../components/ResizableTable';
import { SortableTh } from '../components/SortableTh';
import {
  EmptyRow,
  ErrorAlert,
  Hint,
  ICON,
  LoadingState,
  NoValue,
  NumTd,
  Page,
  RefreshButton,
  UserStatusBadge,
} from '../ui';

type StatsMap = Record<string, UserStats | 'loading' | 'error'>;

export function Users() {
  // Seed from the module cache so leaving and re-entering the tab restores the
  // already-loaded table instantly — no refetch, no per-user loading animation.
  const { data: users, error } = useUsers();
  const [stats, setStats] = useState<StatsMap>(() => getCached<StatsMap>(CACHE_KEYS.usersStats) ?? {});
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<Sort | null>(null);
  const navigate = useNavigate();
  const statsStarted = useRef(false);
  // Tracks whether the component is still mounted so in-flight stats workers
  // stop writing once we navigate away — a canceled fetch must leave the
  // entry as 'loading' (not 'error') so the next visit refetches it.
  const aliveRef = useRef(true);
  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  // Keep the stats module cache in sync so the next mount can restore without
  // refetching (the users list itself is cached by the useUsers hook above).
  useEffect(() => {
    setCached(CACHE_KEYS.usersStats, stats);
  }, [stats]);

  // Load per-user Drive totals progressively (cache hits are instant; a
  // refresh re-runs GAM per user, a few at a time so a big org doesn't fire
  // everything at once). Only the users in `list` are touched, so a resume
  // after switching tabs doesn't wipe the totals already fetched.
  const loadStats = (list: WorkspaceUser[], refresh: boolean) => {
    setStats((prev) => ({ ...prev, ...Object.fromEntries(list.map((u) => [u.email, 'loading' as const])) }));
    const queue = [...list];
    const worker = async () => {
      for (let u = queue.shift(); u; u = queue.shift()) {
        if (!aliveRef.current) return; // unmounted — leave remaining entries as 'loading' for the next visit to resume
        try {
          const s = await api<UserStats>(withRefresh(endpoints.userStats(u.email), refresh));
          if (!aliveRef.current) return;
          setStats((prev) => ({ ...prev, [u.email]: s }));
        } catch {
          if (!aliveRef.current) return;
          setStats((prev) => ({ ...prev, [u.email]: 'error' }));
        }
      }
    };
    for (let i = 0; i < 3; i++) void worker();
  };

  useEffect(() => {
    if (!users || statsStarted.current) return;
    statsStarted.current = true;
    // Only fetch users whose totals aren't already cached (a settled object);
    // 'loading'/'error'/missing all get retried, so an interrupted first load resumes.
    const pending = users.filter((u) => typeof stats[u.email] !== 'object');
    if (pending.length) loadStats(pending, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [users]);

  const rows = useMemo(() => {
    if (!users) return [];
    const q = query.toLowerCase();
    const out = users.filter(
      (u) =>
        u.email.toLowerCase().includes(q) ||
        u.name.toLowerCase().includes(q) ||
        u.orgUnitPath.toLowerCase().includes(q),
    );
    return sortRows(out, sort, (u, key) => {
      const s = stats[u.email];
      switch (key) {
        case 'name':
          return u.name;
        case 'email':
          return u.email;
        case 'org':
          return u.orgUnitPath;
        case 'files':
          return typeof s === 'object' ? s.files : -1;
        case 'size':
          return typeof s === 'object' ? s.totalSize : -1;
        default:
          return '';
      }
    });
  }, [users, query, sort, stats]);

  return (
    <Page
      title="Drive audit"
      actions={
        <>
          {users && <Text c="dimmed">{plural(users.length, 'user')}</Text>}
          <RefreshButton
            disabled={!users || Object.values(stats).some((s) => s === 'loading')}
            onClick={() => users && loadStats(users, true)}
          >
            Refresh stats
          </RefreshButton>
        </>
      }
    >
      <TextInput
        placeholder="Search by name, email, or org unit…"
        aria-label="Search users"
        leftSection={<IconSearch size={ICON.md} aria-hidden />}
        value={query}
        onChange={(e) => setQuery(e.currentTarget.value)}
        maw={420}
      />
      {error && <ErrorAlert title="Could not load users">{error}</ErrorAlert>}
      {!users && !error && <LoadingState label="Loading workspace users…" />}
      {users && (
        <ResizableTable storageKey="users" highlightOnHover withTableBorder>
          <Table.Thead>
            <Table.Tr>
              <SortableTh label="Name" k="name" sort={sort} setSort={setSort} />
              <SortableTh label="Email" k="email" sort={sort} setSort={setSort} />
              <SortableTh label="Org unit" k="org" sort={sort} setSort={setSort} />
              <SortableTh label="Files" k="files" sort={sort} setSort={setSort} defaultDir={-1} numeric />
              <SortableTh label="Drive storage" k="size" sort={sort} setSort={setSort} defaultDir={-1} numeric />
              <ResizableTh k="status">Status</ResizableTh>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {rows.map((u) => {
              const s = stats[u.email];
              return (
                <Table.Tr key={u.email} style={{ cursor: 'pointer' }} onClick={() => navigate(routes.user(u.email))}>
                  <Table.Td>
                    <Anchor
                      component={Link}
                      size="sm"
                      to={routes.user(u.email)}
                      onClick={(e: MouseEvent) => e.stopPropagation()}
                    >
                      {u.name || u.email}
                    </Anchor>
                  </Table.Td>
                  <Table.Td>{u.email}</Table.Td>
                  <Table.Td>{u.orgUnitPath}</Table.Td>
                  <NumTd>
                    {s === 'loading' ? (
                      <Loader size="xs" />
                    ) : typeof s === 'object' ? (
                      <Text size="sm">
                        {s.files}
                        <Text span size="xs" c="dimmed">
                          {' '}
                          (+{plural(s.folders, 'folder')})
                        </Text>
                      </Text>
                    ) : (
                      <StatsMissing failed={s === 'error'} />
                    )}
                  </NumTd>
                  <NumTd>
                    {typeof s === 'object' ? (
                      <Tooltip label={`As of ${fmtDate(s.updatedAt)}`}>
                        <Text size="sm">{fmtSize(s.totalSize)}</Text>
                      </Tooltip>
                    ) : s === 'loading' ? (
                      <NoValue />
                    ) : (
                      <StatsMissing failed={s === 'error'} />
                    )}
                  </NumTd>
                  <Table.Td>
                    <UserStatusBadge suspended={u.suspended} />
                  </Table.Td>
                </Table.Tr>
              );
            })}
            {rows.length === 0 && (
              <EmptyRow colSpan={6} message={query ? <>No users match “{query}”.</> : 'No users yet.'} />
            )}
          </Table.Tbody>
        </ResizableTable>
      )}
      <Hint>
        Click a user to browse their Drive. File counts and storage reflect items the user <b>owns</b> (Google-native
        docs report little or no size). They're cached; Refresh stats recounts every user (runs GAM once per user).
      </Hint>
    </Page>
  );
}

/** Stats cell with no value: a plain dash when never fetched, and a dash that explains itself when the fetch failed. */
function StatsMissing({ failed }: { failed: boolean }) {
  if (!failed) return <NoValue />;
  return (
    <Tooltip label="Could not load stats">
      <span style={{ cursor: 'help' }}>
        <NoValue />
      </span>
    </Tooltip>
  );
}
