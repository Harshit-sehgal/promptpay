/**
 * Pure CSV serialization for advertiser campaign reports. Kept side-effect free
 * (no I/O, no DB) so it is unit-testable and reused by both the export
 * endpoint and any future scheduled export.
 */
export interface ReportRow {
  campaignId: string;
  campaignName: string;
  status: string;
  impressions: number;
  clicks: number;
  ctr: number;
  spendMinor: number;
  currency: string;
}

function csvCell(value: string | number): string {
  const s = String(value);
  if (/[",\n]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export function reportsToCsv(rows: ReportRow[]): string {
  const header = [
    'campaign_id',
    'campaign_name',
    'status',
    'impressions',
    'clicks',
    'ctr_percent',
    'spend_minor',
    'currency',
  ];
  const lines = [header.join(',')];
  for (const r of rows) {
    lines.push(
      [
        csvCell(r.campaignId),
        csvCell(r.campaignName),
        csvCell(r.status),
        csvCell(r.impressions),
        csvCell(r.clicks),
        // r.ctr is a ratio (clicks/impressions), e.g. 0.10 for 10%. The
        // `ctr_percent` column is a percentage, so multiply by 100 before
        // rounding to match the column label and the in-app reports display
        // (A-067).
        csvCell(Number((r.ctr * 100).toFixed(2))),
        csvCell(r.spendMinor),
        csvCell(r.currency),
      ].join(','),
    );
  }
  return lines.join('\n');
}
