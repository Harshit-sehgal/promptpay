export interface ExportCollectionMeta {
  limit: number;
  returned: number;
  truncated: boolean;
}

export interface CappedExportMeta {
  generatedAt: string;
  exportType: 'self_service_recent_activity';
  complete: boolean;
  truncated: boolean;
  collections: Record<string, ExportCollectionMeta>;
}

export function splitCappedRows<T>(
  rows: T[],
  limit: number,
): { data: T[]; meta: ExportCollectionMeta } {
  const truncated = rows.length > limit;
  const data = truncated ? rows.slice(0, limit) : rows;
  return {
    data,
    meta: {
      limit,
      returned: data.length,
      truncated,
    },
  };
}

export function buildCappedExportMeta(
  collections: Record<string, ExportCollectionMeta>,
): CappedExportMeta {
  const truncated = Object.values(collections).some((collection) => collection.truncated);
  return {
    generatedAt: new Date().toISOString(),
    exportType: 'self_service_recent_activity',
    complete: !truncated,
    truncated,
    collections,
  };
}
