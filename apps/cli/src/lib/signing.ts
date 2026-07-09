import * as crypto from 'crypto';

function sortKeysDeep<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item) => sortKeysDeep(item)) as T;
  }
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(obj).sort()) {
      sorted[key] = sortKeysDeep(obj[key]);
    }
    return sorted as T;
  }
  return value;
}

function canonicalJson(payload: Record<string, unknown>): string {
  return JSON.stringify(sortKeysDeep(payload));
}

export function signPayload(payload: Record<string, unknown>, secret: string): string {
  return crypto.createHmac('sha256', secret).update(canonicalJson(payload)).digest('hex');
}
