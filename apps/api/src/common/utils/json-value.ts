const MAX_JSON_DEPTH = 20;

/**
 * Validate that a value is a safe, JSON-serializable structure before it is
 * persisted to a JSON/JSONB column (e.g. Stripe webhook payloads, consent
 * metadata).
 *
 * Rejects values that are not JSON-serializable (functions, symbols, bigint,
 * undefined), cyclic references, excessively deep nesting, and
 * prototype-pollution keys (`__proto__`, `constructor`, `prototype`). Prisma's
 * `InputJsonValue` only type-checks at compile time; this guards runtime input
 * (which may originate from an external provider) from corrupting a JSON
 * column or smuggling a prototype-pollution payload into the row.
 */
export function assertSafeJson(value: unknown, path = '$'): void {
  const seen = new WeakSet<object>();

  const walk = (v: unknown, p: string, depth: number): void => {
    if (depth > MAX_JSON_DEPTH) {
      throw new Error(`JSON value too deeply nested at ${p}`);
    }
    if (v === null) return;
    const t = typeof v;
    if (t === 'string' || t === 'number' || t === 'boolean') return;
    if (t === 'function' || t === 'undefined' || t === 'symbol' || t === 'bigint') {
      throw new Error(`Non-JSON-serializable value of type ${t} at ${p}`);
    }
    if (typeof v !== 'object') return;
    if (seen.has(v as object)) throw new Error(`Cyclic reference at ${p}`);
    seen.add(v as object);

    if (Array.isArray(v)) {
      v.forEach((item, i) => walk(item, `${p}[${i}]`, depth + 1));
      return;
    }

    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      if (k === '__proto__' || k === 'constructor' || k === 'prototype') {
        throw new Error(`Disallowed key "${k}" at ${p}`);
      }
      walk(val, `${p}.${k}`, depth + 1);
    }
  };

  walk(value, path, 0);
}
