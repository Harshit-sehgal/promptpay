'use client';

import { useState } from 'react';
import { Notice } from '@/components/dash';
import { getErrorMessage } from '@/lib/api/errors';
import { adminApi, type PeopleUsersParams, type PeopleWaitlistParams } from '@/lib/api/services';
import { buildCsv, type CsvColumn } from '@/lib/csv';

import { downloadCsv } from './controls';
import type { ExportResponse } from './types';

/** Fetches every row that matches the current filters and saves them as CSV. */
export function ExportButton<Row>({
  kind,
  params,
  columns,
}: {
  kind: 'users' | 'waitlist';
  params: PeopleUsersParams | PeopleWaitlistParams;
  columns: CsvColumn<Row>[];
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [truncated, setTruncated] = useState(false);

  const run = async () => {
    setBusy(true);
    setError(null);
    setTruncated(false);
    try {
      const res = (await adminApi.exportPeople(kind, params)) as { data: ExportResponse<Row> };
      const csv = buildCsv(columns, res.data.rows ?? []);
      const day = new Date().toISOString().slice(0, 10);
      downloadCsv(`ateva-${kind === 'users' ? 'registered' : 'waitlist'}-${day}.csv`, csv);
      setTruncated(Boolean(res.data.truncated));
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Export failed'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={run}
        disabled={busy}
        className="dash-btn dash-btn--secondary dash-btn--sm"
      >
        {busy ? 'Exporting' : 'Export CSV'}
      </button>
      {(error || truncated) && (
        <div className="basis-full">
          {error ? (
            <Notice tone="bad" role="alert">
              {error}
            </Notice>
          ) : (
            <Notice tone="warn" role="status">
              The export stopped at 10,000 rows. Narrow the filters to export the rest.
            </Notice>
          )}
        </div>
      )}
    </>
  );
}
