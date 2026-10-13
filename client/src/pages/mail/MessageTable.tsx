import { useMemo, useState } from 'react';
import { Anchor, Badge, Table, Text, Tooltip } from '@mantine/core';
import { MailMessage } from '../../api';
import { fmtDate, fmtDay, fmtSize } from '../../lib/format';
import { Sort, sortRows } from '../../lib/table';
import { ResizableTable } from '../../components/ResizableTable';
import { SortableTh } from '../../components/SortableTh';
import { EmptyRow, NumTd } from '../../ui';

interface MessageTableProps {
  rows: MailMessage[];
  showUser?: boolean;
  showSize?: boolean;
  onOpen: (user: string, id: string) => void;
}

/** Message list shared by mailbox browsing and domain-wide search. */
export function MessageTable({ rows, showUser, showSize, onOpen }: MessageTableProps) {
  const [sort, setSort] = useState<Sort | null>(null);
  const sorted = useMemo(
    () =>
      sortRows(rows, sort, (m, key) => {
        switch (key) {
          case 'date':
            return new Date(m.date).getTime() || 0;
          case 'mailbox':
            return m.user;
          case 'from':
            return m.from;
          case 'size':
            return m.size;
          default:
            return m.subject;
        }
      }),
    [rows, sort],
  );
  const colSpan = 3 + (showUser ? 1 : 0) + (showSize ? 1 : 0);
  return (
    <ResizableTable storageKey="mail-messages" highlightOnHover withTableBorder>
      <Table.Thead>
        <Table.Tr>
          <SortableTh label="Date" k="date" sort={sort} setSort={setSort} defaultDir={-1} />
          {showUser && <SortableTh label="Mailbox" k="mailbox" sort={sort} setSort={setSort} />}
          <SortableTh label="From" k="from" sort={sort} setSort={setSort} />
          <SortableTh label="Subject" k="subject" sort={sort} setSort={setSort} />
          {showSize && <SortableTh label="Size" k="size" sort={sort} setSort={setSort} defaultDir={-1} numeric />}
        </Table.Tr>
      </Table.Thead>
      <Table.Tbody>
        {sorted.map((m) => (
          <Table.Tr key={`${m.user}-${m.id}`} style={{ cursor: 'pointer' }} onClick={() => onOpen(m.user, m.id)}>
            <Table.Td>
              {/* Day only keeps the list narrow; the full timestamp is a hover away (and in the message). */}
              <Tooltip label={fmtDate(m.date)}>
                <Text size="sm" c="dimmed" style={{ whiteSpace: 'nowrap' }}>
                  {fmtDay(m.date)}
                </Text>
              </Tooltip>
            </Table.Td>
            {showUser && (
              <Table.Td>
                <Badge variant="light" size="sm" tt="none">
                  {m.user}
                </Badge>
              </Table.Td>
            )}
            {/* Width caps on From/Subject keep the list unscrolled beside the label sidebar (lg+) and on tablets. */}
            <Table.Td maw={200}>
              <Text size="sm" truncate>
                {m.from}
              </Text>
            </Table.Td>
            <Table.Td maw={360}>
              {/* A real button so the message opens by keyboard; the row click is a mouse convenience. */}
              <Anchor
                component="button"
                type="button"
                size="sm"
                truncate
                display="block"
                w="100%"
                ta="left"
                fw={m.labels.includes('UNREAD') ? 700 : undefined}
                onClick={(e) => {
                  e.stopPropagation();
                  onOpen(m.user, m.id);
                }}
              >
                {m.subject || '(no subject)'}
              </Anchor>
              <Text size="xs" c="dimmed" truncate>
                {m.snippet}
              </Text>
            </Table.Td>
            {showSize && <NumTd fw={600}>{fmtSize(m.size)}</NumTd>}
          </Table.Tr>
        ))}
        {rows.length === 0 && <EmptyRow colSpan={colSpan} message="No messages." />}
      </Table.Tbody>
    </ResizableTable>
  );
}
