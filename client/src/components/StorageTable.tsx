import { useCallback, useMemo, useState, type MouseEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Anchor, Table } from '@mantine/core';
import { StorageRow } from '../api';
import { fmtSize } from '../lib/format';
import { Sort, sortRows } from '../lib/table';
import { useUsers } from '../lib/useUsers';
import { EmptyRow, ErrorAlert, LoadingState, NoValue, NumTd, TEXT, UserStatusBadge } from '../ui';
import { ResizableTable, ResizableTh } from './ResizableTable';
import { SortableTh } from './SortableTh';

const MB = 1024 * 1024;
/** Gmail usage above this (5 GB) is highlighted as a cleanup candidate. */
const GMAIL_HEAVY_MB = 5120;

interface StorageTableProps {
  rows: StorageRow[];
  /** Where a row leads — the user's Drive (Dashboard) or mailbox (Email audit). */
  linkTo: (email: string) => string;
  /** ResizableTable persistence key; one per page so each keeps its own column widths. */
  storageKey: string;
  defaultSort: 'gmail' | 'total';
  emptyMessage: string;
}

/**
 * Per-user Gmail/Drive storage from the Admin Reports API, joined with the users list for
 * display name + account state. Waits for that list so names are there on first paint (no
 * email→name flash); if it fails, lists emails only rather than spin forever.
 */
export function StorageTable({ rows, linkTo, storageKey, defaultSort, emptyMessage }: StorageTableProps) {
  const [sort, setSort] = useState<Sort | null>({ key: defaultSort, dir: -1 });
  const navigate = useNavigate();
  const { data: users, error: usersError } = useUsers();

  const byEmail = useMemo(() => new Map((users ?? []).map((u) => [u.email, u])), [users]);
  const nameOf = useCallback((email: string) => byEmail.get(email)?.name || email, [byEmail]);

  const sorted = useMemo(
    () =>
      sortRows(rows, sort, (r, key) => {
        switch (key) {
          case 'name':
            return nameOf(r.email);
          case 'gmail':
            return r.gmailMb;
          case 'drive':
            return r.driveMb;
          case 'total':
            return r.totalMb;
          default:
            return r.email;
        }
      }),
    [rows, sort, nameOf],
  );

  if (!users && !usersError) return <LoadingState label="Loading users…" />;

  return (
    <>
      {usersError && (
        <ErrorAlert title="Could not load users">
          {usersError} Names and account status are unavailable, so the table lists email addresses only.
        </ErrorAlert>
      )}
      <ResizableTable storageKey={storageKey} highlightOnHover withTableBorder>
        <Table.Thead>
          <Table.Tr>
            <SortableTh label="Name" k="name" sort={sort} setSort={setSort} />
            <SortableTh label="Email" k="email" sort={sort} setSort={setSort} />
            <SortableTh label="Gmail" k="gmail" sort={sort} setSort={setSort} defaultDir={-1} numeric />
            <SortableTh label="Drive" k="drive" sort={sort} setSort={setSort} defaultDir={-1} numeric />
            <SortableTh label="Total" k="total" sort={sort} setSort={setSort} defaultDir={-1} numeric />
            <ResizableTh k="status">Status</ResizableTh>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {sorted.map((r) => {
            const u = byEmail.get(r.email);
            const heavy = r.gmailMb > GMAIL_HEAVY_MB;
            return (
              <Table.Tr key={r.email} style={{ cursor: 'pointer' }} onClick={() => navigate(linkTo(r.email))}>
                <Table.Td>
                  <Anchor
                    component={Link}
                    size="sm"
                    to={linkTo(r.email)}
                    onClick={(e: MouseEvent) => e.stopPropagation()}
                  >
                    {nameOf(r.email)}
                  </Anchor>
                </Table.Td>
                <Table.Td>{r.email}</Table.Td>
                <NumTd fw={heavy ? 700 : undefined} c={heavy ? TEXT.warning : undefined}>
                  {fmtSize(r.gmailMb * MB)}
                </NumTd>
                <NumTd>{fmtSize(r.driveMb * MB)}</NumTd>
                <NumTd fw={600}>{fmtSize(r.totalMb * MB)}</NumTd>
                <Table.Td>{u ? <UserStatusBadge suspended={u.suspended} /> : <NoValue />}</Table.Td>
              </Table.Tr>
            );
          })}
          {sorted.length === 0 && <EmptyRow colSpan={6} message={emptyMessage} />}
        </Table.Tbody>
      </ResizableTable>
    </>
  );
}
