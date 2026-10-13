import type { ReactNode } from 'react';
import { Table, type TableTdProps } from '@mantine/core';

/**
 * Cell for a numeric column (sizes, counts): right-aligned, never wraps ("12.6 KB" stays on one line),
 * tabular figures so digits line up down the column. Pair with `<SortableTh numeric>`.
 */
export function NumTd({ children, ...props }: TableTdProps & { children: ReactNode }) {
  return (
    <Table.Td ta="right" className="gam-num" {...props}>
      {children}
    </Table.Td>
  );
}
