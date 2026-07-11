import { describe, expect, it } from 'vitest';

import {
  buildCappedExportMeta,
  type ExportCollectionMeta,
  splitCappedRows,
} from './export-metadata';

describe('splitCappedRows (A-072 / #4)', () => {
  it('returns all rows and marks not truncated when under the limit', () => {
    const { data, meta } = splitCappedRows([1, 2, 3], 10);
    expect(data).toEqual([1, 2, 3]);
    expect(meta).toEqual({ limit: 10, returned: 3, truncated: false });
  });

  it('truncates to the limit and reports truncation', () => {
    const { data, meta } = splitCappedRows([1, 2, 3, 4, 5], 3);
    expect(data).toEqual([1, 2, 3]);
    expect(meta).toEqual({ limit: 3, returned: 3, truncated: true });
  });
});

describe('buildCappedExportMeta (A-072 / #4)', () => {
  it('is complete only when no collection is truncated', () => {
    const collections: Record<string, ExportCollectionMeta> = {
      activity: { limit: 10, returned: 10, truncated: false },
    };
    const meta = buildCappedExportMeta(collections);
    expect(meta.complete).toBe(true);
    expect(meta.truncated).toBe(false);
    expect(meta.exportType).toBe('self_service_recent_activity');
    expect(typeof meta.generatedAt).toBe('string');
  });

  it('flags truncation when any collection is truncated', () => {
    const collections: Record<string, ExportCollectionMeta> = {
      activity: { limit: 10, returned: 10, truncated: true },
    };
    const meta = buildCappedExportMeta(collections);
    expect(meta.complete).toBe(false);
    expect(meta.truncated).toBe(true);
  });
});
