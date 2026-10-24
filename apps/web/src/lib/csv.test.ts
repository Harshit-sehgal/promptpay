import { describe, expect, it } from 'vitest';

import { buildCsv, csvCell } from './csv';

describe('csvCell', () => {
  it('quotes every cell and doubles embedded quotes', () => {
    expect(csvCell('plain')).toBe('"plain"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell('a,b\nc')).toBe('"a,b\nc"');
  });

  it('renders empty values as an empty quoted cell', () => {
    expect(csvCell(null)).toBe('""');
    expect(csvCell(undefined)).toBe('""');
    expect(csvCell('')).toBe('""');
  });

  it('prefixes formula lead-ins so spreadsheets read them as text', () => {
    expect(csvCell('=SUM(A1:A9)')).toBe(`"'=SUM(A1:A9)"`);
    expect(csvCell('+1')).toBe(`"'+1"`);
    expect(csvCell('-2+3')).toBe(`"'-2+3"`);
    expect(csvCell('@cmd')).toBe(`"'@cmd"`);
    expect(csvCell('\t=1')).toBe(`"'\t=1"`);
    expect(csvCell('\r=1')).toBe(`"'\r=1"`);
  });

  it('prefixes before escaping quotes', () => {
    expect(csvCell('=HYPERLINK("http://x")')).toBe(`"'=HYPERLINK(""http://x"")"`);
  });

  it('leaves safe text, numbers and booleans alone', () => {
    expect(csvCell('a=b')).toBe('"a=b"');
    expect(csvCell('2026-10-01T00:00:00.000Z')).toBe('"2026-10-01T00:00:00.000Z"');
    expect(csvCell(-5)).toBe('"-5"');
    expect(csvCell(12)).toBe('"12"');
    expect(csvCell(true)).toBe('"true"');
  });
});

describe('buildCsv', () => {
  it('writes a header row and one CRLF line per row', () => {
    const csv = buildCsv(
      [
        { header: 'Email', value: (r: { email: string; n: number }) => r.email },
        { header: 'Count', value: (r) => r.n },
      ],
      [
        { email: 'a@b.c', n: 1 },
        { email: '=cmd', n: 2 },
      ],
    );
    expect(csv).toBe('"Email","Count"\r\n"a@b.c","1"\r\n"\'=cmd","2"');
  });

  it('returns only the header when there are no rows', () => {
    expect(buildCsv([{ header: 'Email', value: () => '' }], [])).toBe('"Email"');
  });
});
