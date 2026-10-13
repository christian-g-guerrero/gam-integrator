import { describe, expect, it } from 'vitest';
import { parseGamCsv } from './csv.js';

describe('parseGamCsv', () => {
  it('parses headers into row objects', () => {
    const rows = parseGamCsv('primaryEmail,name.fullName\na@b.com,Alice\n');
    expect(rows).toEqual([{ primaryEmail: 'a@b.com', 'name.fullName': 'Alice' }]);
  });

  it('handles quoted fields with commas', () => {
    const rows = parseGamCsv('id,name\n1,"Budget, Final"\n');
    expect(rows[0].name).toBe('Budget, Final');
  });

  it('returns empty array for empty output', () => {
    expect(parseGamCsv('')).toEqual([]);
    expect(parseGamCsv('\n')).toEqual([]);
  });

  it('tolerates ragged rows (GAM sometimes emits variable columns)', () => {
    const rows = parseGamCsv('a,b,c\n1,2\n');
    expect(rows.length).toBe(1);
  });
});
