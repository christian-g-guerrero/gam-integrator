/** Shared table-sorting helpers (used with SortableTh). */

export interface Sort {
  key: string;
  dir: 1 | -1;
}

/** Comparator: numeric when both numbers, else case-insensitive string. */
function cmp(a: unknown, b: unknown): number {
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return String(a ?? '').localeCompare(String(b ?? ''), undefined, { sensitivity: 'base' });
}

/** Sorted copy of `rows` per `sort`; `val` maps a row + sort key to its sortable value. Returns `rows` untouched when sort is null. */
export function sortRows<T>(rows: T[], sort: Sort | null, val: (row: T, key: string) => unknown): T[] {
  if (!sort) return rows;
  return [...rows].sort((a, b) => sort.dir * cmp(val(a, sort.key), val(b, sort.key)));
}
