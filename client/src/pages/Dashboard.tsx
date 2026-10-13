import { Card, Flex, Group, RingProgress, Stack, Text } from '@mantine/core';
import { IconDatabase } from '@tabler/icons-react';
import { DashboardSummary, routes, withRefresh } from '../api';
import { fmtDate, fmtSize } from '../lib/format';
import { CACHE_KEYS } from '../lib/pageCache';
import { useApi } from '../lib/useApi';
import { StorageTable } from '../components/StorageTable';
import { ErrorAlert, Hint, LoadingState, Page, RefreshButton, SectionTitle, Stat, TEXT, useAppearance } from '../ui';

const MB = 1024 * 1024;

/** Segmented storage-ring palette (skins with `segmentedRing`): one pastel -fill per
 *  contributor arc, largest first. Each skin that sets the trait defines these. */
const RING_FILLS = [
  'var(--red-fill)',
  'var(--blue-fill)',
  'var(--yellow-fill)',
  'var(--green-fill)',
  'var(--grape-fill)',
  'var(--teal-fill)',
];

/** Workspace overview: pooled-storage usage + per-user Gmail/Drive totals, cached across visits. */
export function Dashboard() {
  // Seed from the module cache so switching back to this page is instant — no
  // loader flash and no refetch unless the user asks for a refresh.
  const { data, error, loading, reload } = useApi<DashboardSummary>(
    (refresh) => withRefresh('/api/dashboard/summary', refresh),
    { cacheKey: CACHE_KEYS.dashboard },
  );
  const { skinTraits } = useAppearance();
  const pool = data?.pool;
  const pct = pool && pool.totalMb > 0 ? (pool.usedMb / pool.totalMb) * 100 : 0;
  const freeMb = pool ? Math.max(pool.totalMb - pool.usedMb, 0) : 0;
  const color = pct >= 90 ? 'red' : pct >= 70 ? 'orange' : 'green';
  const usedText = pct >= 90 ? TEXT.danger : pct >= 70 ? TEXT.warning : TEXT.success;

  // A `segmentedRing` skin renders the pool as a multi-segment donut: one arc per
  // top contributor, largest first, the remainder (free + long tail) left as the
  // track. Every other skin draws a single used-vs-free arc. Track color and cap
  // shape are the skin stylesheet's job.
  const usedPct = Math.min(pct, 100);
  const ringSections = skinTraits.segmentedRing
    ? [...(data?.users ?? [])]
        .filter((u) => u.totalMb > 0)
        .sort((a, b) => b.totalMb - a.totalMb)
        .slice(0, RING_FILLS.length)
        .map((u, i) => ({
          value: pool && pool.totalMb > 0 ? (u.totalMb / pool.totalMb) * 100 : 0,
          color: RING_FILLS[i],
          tooltip: `${u.email}: ${fmtSize(u.totalMb * MB)}`,
        }))
    : [{ value: usedPct, color }];

  return (
    <Page title="Dashboard" actions={<RefreshButton loading={loading} onClick={() => reload(true)} />}>
      {error && <ErrorAlert title="Could not load the dashboard">{error}</ErrorAlert>}
      {!data ? (
        !error && <LoadingState label="Loading workspace usage…" />
      ) : (
        <>
          <Card padding="lg">
            {/* Ring beside the stats on desktop; stacked (ring centered, stats full-width
                below) once the row would get too cramped, at the sm breakpoint. */}
            <Flex direction={{ base: 'column', sm: 'row' }} align={{ base: 'stretch', sm: 'center' }} gap="lg">
              <RingProgress
                style={{ alignSelf: 'center' }}
                size={168}
                thickness={16}
                roundCaps
                sections={ringSections}
                label={
                  <Stack gap={0} align="center">
                    <Text fw={700} size="xl">
                      {pct.toFixed(0)}%
                    </Text>
                    <Text size="xs" c="dimmed">
                      used
                    </Text>
                  </Stack>
                }
              />
              <Stack gap="xs" flex={1}>
                <SectionTitle icon={IconDatabase}>Pooled storage</SectionTitle>
                <Group gap={0} grow>
                  <Stat label="Total pool" value={fmtSize((pool?.totalMb ?? 0) * MB)} />
                  <Stat label="Used" value={fmtSize((pool?.usedMb ?? 0) * MB)} c={usedText} />
                  <Stat label="Free" value={fmtSize(freeMb * MB)} c={TEXT.success} />
                </Group>
                <Hint>
                  Report date: <b>{pool?.reportDate || '—'}</b> (Google's usage reports lag ~2 days) · fetched{' '}
                  {fmtDate(data.updatedAt)}
                </Hint>
              </Stack>
            </Flex>
          </Card>

          <SectionTitle>Storage by user</SectionTitle>
          {/* No maw: the table spans the page's data width so it lines up with the
              pooled-storage card above it (standard page width, set by <Page>). */}
          <StorageTable
            rows={data.users}
            linkTo={routes.user}
            storageKey="dashboard-storage"
            defaultSort="total"
            emptyMessage="No storage usage reported yet."
          />
          <Hint>
            Click a user to open their Drive. Per-user Gmail and Drive usage comes from Google's Admin Reports; the
            pooled total above also counts Shared Drives, so it can exceed the sum of the rows.
          </Hint>
        </>
      )}
    </Page>
  );
}
