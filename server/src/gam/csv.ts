import { parse } from 'csv-parse/sync';

/** Parse GAM CSV output into an array of row objects keyed by header. */
export function parseGamCsv(csv: string): Record<string, string>[] {
  const trimmed = csv.trim();
  if (!trimmed) return [];
  return parse(trimmed, {
    columns: true,
    skip_empty_lines: true,
    relax_column_count: true,
    relax_quotes: true,
  }) as Record<string, string>[];
}
