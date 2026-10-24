/**
 * CSV building for operator exports.
 *
 * Every cell is quoted. A text cell that starts with `=`, `+`, `-` or `@`
 * (or a tab or carriage return, which spreadsheets also treat as a formula
 * lead-in) is prefixed with `'` so Excel and Sheets read it as text and never
 * run a formula an attacker typed into a signup form.
 */

const FORMULA_LEAD = /^[=+\-@\t\r]/;

export function csvCell(value: unknown): string {
  let text: string;
  if (value === null || value === undefined) text = '';
  else if (typeof value === 'string') text = FORMULA_LEAD.test(value) ? `'${value}` : value;
  else if (typeof value === 'number' || typeof value === 'boolean') text = String(value);
  else text = JSON.stringify(value);
  return `"${text.replace(/"/g, '""')}"`;
}

export interface CsvColumn<Row> {
  header: string;
  value: (row: Row) => unknown;
}

/** Header row plus one line per row, CRLF separated, no trailing newline. */
export function buildCsv<Row>(columns: CsvColumn<Row>[], rows: Row[]): string {
  const lines = [columns.map((c) => csvCell(c.header)).join(',')];
  for (const row of rows) lines.push(columns.map((c) => csvCell(c.value(row))).join(','));
  return lines.join('\r\n');
}
