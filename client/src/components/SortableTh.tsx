import { Group, Table, UnstyledButton } from '@mantine/core';
import { IconChevronDown, IconChevronUp, IconSelector } from '@tabler/icons-react';
import { Sort } from '../lib/table';
import { ICON } from '../ui';
import { ColResizeHandle, useColumnWidth } from './ResizableTable';

interface SortableThProps {
  label: string;
  k: string;
  sort: Sort | null;
  setSort: (s: Sort | null) => void;
  /** First-click direction: 1 = ascending (names), -1 = descending (sizes, dates). */
  defaultDir?: 1 | -1;
  /** Width before the user ever resizes (auto if omitted). */
  defaultWidth?: number;
  /** Numeric column (sizes, counts): right-aligned to match its <NumTd> cells. */
  numeric?: boolean;
}

/**
 * Sortable table header: 1st activation sorts (defaultDir), 2nd flips, 3rd clears. The label is a real
 * button (keyboard + screen readers) and the th carries aria-sort. Resizable inside a ResizableTable.
 */
export function SortableTh({ label, k, sort, setSort, defaultDir = 1, defaultWidth, numeric }: SortableThProps) {
  const width = useColumnWidth(k) ?? defaultWidth;
  const active = sort?.key === k;
  const next = () => {
    if (!active) setSort({ key: k, dir: defaultDir });
    else if (sort!.dir === defaultDir) setSort({ key: k, dir: (defaultDir * -1) as 1 | -1 });
    else setSort(null);
  };
  return (
    <Table.Th
      data-col={k}
      aria-sort={active ? (sort!.dir === 1 ? 'ascending' : 'descending') : 'none'}
      ta={numeric ? 'right' : undefined}
      style={{ whiteSpace: 'nowrap', width }}
    >
      <UnstyledButton onClick={next} fw="inherit" fz="inherit" c="inherit" style={{ userSelect: 'none' }}>
        <Group gap={4} wrap="nowrap" justify={numeric ? 'flex-end' : undefined}>
          {label}
          {active ? (
            sort!.dir === 1 ? (
              <IconChevronUp size={ICON.xs} aria-hidden />
            ) : (
              <IconChevronDown size={ICON.xs} aria-hidden />
            )
          ) : (
            <IconSelector size={ICON.xs} opacity={0.35} aria-hidden />
          )}
        </Group>
      </UnstyledButton>
      <ColResizeHandle colKey={k} />
    </Table.Th>
  );
}
