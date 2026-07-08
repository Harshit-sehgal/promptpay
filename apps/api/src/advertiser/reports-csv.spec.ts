import { describe, expect, it } from 'vitest';
import { reportsToCsv, type ReportRow } from './reports-csv';

describe('reportsToCsv', () => {
  const rows: ReportRow[] = [
    {
      campaignId: 'c1',
      campaignName: 'Launch, "Big"',
      status: 'active',
      impressions: 100,
      clicks: 5,
      // The API returns CTR as a ratio (clicks/impressions). 0.05 = 5%.
      ctr: 0.05,
      spendMinor: 2500,
      currency: 'USD',
    },
    {
      campaignId: 'c2',
      campaignName: 'Euro plan',
      status: 'paused',
      impressions: 40,
      clicks: 0,
      ctr: 0,
      spendMinor: 0,
      currency: 'EUR',
    },
  ];

  it('emits a header and one line per row', () => {
    const csv = reportsToCsv(rows);
    const lines = csv.split('\n');
    expect(lines[0]).toBe(
      'campaign_id,campaign_name,status,impressions,clicks,ctr_percent,spend_minor,currency',
    );
    expect(lines).toHaveLength(3);
  });

  it('escapes commas and quotes in fields', () => {
    const csv = reportsToCsv(rows);
    expect(csv).toContain('"Launch, ""Big"""');
  });

  it('converts a ratio CTR to a percentage in the ctr_percent column', () => {
    // 1 click / 3 impressions ~ 0.3333 ratio -> 33.33% in the CSV column.
    const csv = reportsToCsv([
      {
        campaignId: 'x',
        campaignName: 'y',
        status: 'active',
        impressions: 3,
        clicks: 1,
        ctr: 0.3333,
        spendMinor: 10,
        currency: 'USD',
      },
    ]);
    expect(csv.split('\n')[1]).toContain(',33.33,');
  });

  it('converts a 5 percent ratio CTR to 5 in the ctr_percent column', () => {
    const csv = reportsToCsv([rows[0]]);
    expect(csv.split('\n')[1]).toContain(',5,');
  });

  it('handles an empty report', () => {
    expect(reportsToCsv([]).split('\n')).toHaveLength(1);
  });
});
