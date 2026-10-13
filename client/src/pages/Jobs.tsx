import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Anchor, Group, Progress, Table, Text } from '@mantine/core';
import { api, JobSummary } from '../api';
import { fmtDate } from '../lib/format';
import { Sort, sortRows } from '../lib/table';
import { ResizableTable, ResizableTh } from '../components/ResizableTable';
import { SortableTh } from '../components/SortableTh';
import { EmptyState, ErrorAlert, LoadingState, NoValue, Page, StatusBadge } from '../ui';

export function Jobs() {
  const [jobs, setJobs] = useState<JobSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sort, setSort] = useState<Sort | null>(null);

  useEffect(() => {
    let alive = true;
    const load = () =>
      api<JobSummary[]>('/api/jobs').then(
        (j) => {
          if (alive) {
            setJobs(j);
            setError(null);
          }
        },
        (e) => {
          if (alive) setError(e.message);
        },
      );
    void load(); // rejections are handled inside load()
    const t = setInterval(load, 3000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  const rows = useMemo(
    () => sortRows(jobs ?? [], sort, (j, key) => (key === 'job' ? j.title : key === 'status' ? j.status : j.createdAt)),
    [jobs, sort],
  );

  return (
    <Page title="Jobs">
      {error && !jobs && <ErrorAlert title="Could not load jobs">{error}</ErrorAlert>}
      {!jobs ? (
        !error && <LoadingState label="Loading jobs…" />
      ) : jobs.length === 0 ? (
        <EmptyState message="No jobs yet." hint="Ownership transfers and mailbox exports will show up here." />
      ) : (
        <ResizableTable storageKey="jobs" highlightOnHover withTableBorder>
          <Table.Thead>
            <Table.Tr>
              <SortableTh label="Job" k="job" sort={sort} setSort={setSort} />
              <SortableTh label="Status" k="status" sort={sort} setSort={setSort} />
              <ResizableTh k="progress" defaultWidth={200}>
                Progress
              </ResizableTh>
              <SortableTh label="Started" k="started" sort={sort} setSort={setSort} defaultDir={-1} />
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {rows.map((j) => (
              <Table.Tr key={j.id}>
                <Table.Td>
                  <Anchor component={Link} to={`/jobs/${j.id}`} size="sm">
                    {j.title}
                  </Anchor>
                </Table.Td>
                <Table.Td>
                  <StatusBadge status={j.status} />
                </Table.Td>
                <Table.Td>
                  {j.progress.total ? (
                    <Group gap="xs" wrap="nowrap">
                      <Progress
                        value={(100 * j.progress.done) / j.progress.total}
                        size="lg"
                        striped={j.status === 'running'}
                        animated={j.status === 'running'}
                        aria-label={`${j.title}: ${j.progress.done} of ${j.progress.total}`}
                        flex={1}
                        miw={80}
                      />
                      <Text size="xs" c="dimmed" className="gam-num">
                        {j.progress.done}/{j.progress.total}
                      </Text>
                    </Group>
                  ) : (
                    <NoValue />
                  )}
                </Table.Td>
                <Table.Td>
                  <Text size="sm" c="dimmed">
                    {fmtDate(j.createdAt)}
                  </Text>
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </ResizableTable>
      )}
    </Page>
  );
}
