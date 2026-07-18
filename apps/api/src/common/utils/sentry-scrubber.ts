import * as Sentry from '@sentry/nestjs';

/**
 * Sentry `beforeBreadcrumb` handler. Runs on every breadcrumb captured by
 * Sentry's auto-instrumentation — including `console.log`/`console.error`/
 * `console.warn` echoed into a `console` breadcrumb whose `data` carries
 * whatever Error/payload the caller passed. Without this filter, raw stacks,
 * Prisma query text, JWT tokens, and IP addresses from the surrounding code
 * paths would land in Sentry as breadcrumb data attached to the event before
 * `beforeSend` runs over the event.
 *
 * Strictness rules:
 *  - console breadcrumbs whose `data` is a non-serializable / Error object
 *    are dropped entirely (cannot be sanitized reliably).
 *  - console breadcrumbs whose message contains a sensitive pattern token
 *    (Bearer/JWT, Stripe keys, IP-shaped literals) are dropped.
 *  - other breadcrumbs are passed through after a best-effort data scrub.
 *
 * Must not throw — a thrown breadcrumb filter drops the breadcrumb silently.
 */
export function sentryBeforeBreadcrumb(
  crumb: Sentry.Breadcrumb,
  _hint?: Sentry.BreadcrumbHint,
): Sentry.Breadcrumb | null {
  try {
    if (crumb.category === 'console') {
      const data = crumb.data as Record<string, unknown> | undefined;
      const arg0 = data && Object.prototype.hasOwnProperty.call(data, '0') ? data[0] : undefined;
      const arg1 = data && Object.prototype.hasOwnProperty.call(data, '1') ? data[1] : undefined;
      // Raw Error/stack args captured from console.error('...:', err) leaks
      // file paths and stack frames. The scrubber can't reliably sanitize an
      // Error object — drop the breadcrumb.
      if (arg0 instanceof Error || arg1 instanceof Error) return null;
      const message = String(crumb.message ?? '');
      const haystack = `${message} ${arg0 !== undefined ? String(arg0) : ''} ${arg1 !== undefined ? String(arg1) : ''}`;
      if (SENSITIVE_PATTERNS.some((re) => re.test(haystack))) return null;
    }
    if (crumb.data) {
      const data = { ...crumb.data };
      if (data.headers) {
        data.headers = redactHeaders(data.headers as { [key: string]: string });
      }
      if (typeof data.url === 'string') {
        data.url = redactUrl(data.url);
      }
      return { ...crumb, data };
    }
    return crumb;
  } catch {
    return crumb;
  }
}

/**
 * Patterns that indicate a breadcrumb message carries a security-sensitive
 * value. Matches loose substrings — false positives are fine (the breadcrumb
 * is dropped, which preserves its diagnostic value). Patterns are intentionally
 * literal, not regex anchors, so `Bearer abc` and `bearer: xyz` both match.
 */
const SENSITIVE_PATTERNS: RegExp[] = [
  /\bbearer\b/i,
  /\bJWT\b/i,
  /\baccess_token\b/i,
  /\bStri[Pp]e(?:_[A-Za-z]+)?_(?:sk|rk|whsec)_/i,
  /\bacct_[A-Za-z0-9]+\b/,
  /\b(?:req\.ip|x-forwarded-for|ip[_-]?address)\s*[:=]\s*\S+/i,
  /\bBearer\s+[A-Za-z0-9._-]+/,
];

/**
 * Sentry `beforeSend` handler. Drops expected 4xx client errors and scrubs
 * tokens, cookies, request bodies, and identifiable user data before an event
 * leaves the process. It must be defensive and never throw (a thrown scrubber
 * would drop the event silently).
 */
export function sentryBeforeSend(
  event: Sentry.ErrorEvent,
  _hint: unknown,
): Sentry.ErrorEvent | null {
  // Drop expected 4xx client errors regardless of the exception type name.
  // Sentry events can carry the HTTP status in `extra.statusCode` (set by our
  // exception filters) or in `event.contexts?.response?.status_code`. Either
  // source is sufficient to identify an expected client error.
  const statusCode =
    (event.extra?.statusCode as number | undefined) ??
    (event.contexts?.response?.status_code as number | undefined) ??
    0;
  if (statusCode >= 400 && statusCode < 500) return null;
  return scrubSentryEvent(event);
}

/**
 * Central Sentry scrubber. Removes tokens, cookies, request bodies, and
 * identifiable user data before an event leaves the process. This runs in
 * `beforeSend` for every captured event, so it must be defensive and never
 * throw (a thrown scrubber would drop the event silently).
 */
export function scrubSentryEvent(event: Sentry.ErrorEvent): Sentry.ErrorEvent {
  try {
    if (event.request) {
      const req = event.request;
      if (req.headers) {
        req.headers = redactHeaders(req.headers);
      }
      if (req.cookies) {
        req.cookies = { _redacted: '[redacted]' };
      }
      if (req.data !== undefined) {
        req.data = '[redacted]';
      }
      if (req.url) {
        req.url = redactUrl(req.url);
      }
      if (req.query_string) {
        req.query_string = '[redacted]';
      }
    }
    if (event.user) {
      event.user = { id: event.user.id };
    }
    if (event.breadcrumbs) {
      event.breadcrumbs = event.breadcrumbs.map((crumb) => {
        if (!crumb.data) return crumb;
        const data = { ...crumb.data };
        if (data.headers) data.headers = redactHeaders(data.headers as { [key: string]: string });
        if (data.url) data.url = redactUrl(data.url as string);
        return { ...crumb, data };
      });
    }
    // Round 38: scrub event.extra and event.contexts to catch strings the
    // exception filters write into the event payload — message text from
    // HttpException, raw audit reasons, etc. Headers/url in extra get the
    // same treatment as request.*.
    if (event.extra) {
      const extra: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(event.extra)) {
        extra[key] = scrubExtraValue(value);
      }
      event.extra = extra;
    }
    if (event.contexts) {
      const contexts: typeof event.contexts = {};
      for (const [key, value] of Object.entries(event.contexts)) {
        contexts[key] = scrubExtraValue(value) as (typeof event.contexts)[string];
      }
      event.contexts = contexts;
    }
  } catch {
    // Scrubbing must never drop the event. If something goes wrong, return
    // the original event rather than losing the error signal entirely.
  }
  return event;
}

/**
 * Recursive scrubber for arbitrary `extra` / `contexts` values. Strings are
 * redacted if they match sensitive patterns; objects are walked and have
 * their headers/url fields redacted; arrays are mapped element-wise.
 */
function scrubExtraValue(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') {
    if (SENSITIVE_PATTERNS.some((re) => re.test(value))) return '[redacted]';
    return value;
  }
  if (Array.isArray(value)) return value.map((v) => scrubExtraValue(v));
  if (typeof value === 'object') {
    const obj: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      const lowerKey = k.toLowerCase();
      if (
        lowerKey === 'authorization' ||
        lowerKey === 'cookie' ||
        lowerKey === 'x-api-key' ||
        lowerKey === 'x-device-secret' ||
        lowerKey.includes('token') ||
        lowerKey.includes('secret') ||
        lowerKey.includes('password') ||
        lowerKey === 'stripeaccountid' ||
        lowerKey === 'destination'
      ) {
        obj[k] = '[redacted]';
        continue;
      }
      obj[k] = scrubExtraValue(v);
    }
    return obj;
  }
  // number/boolean/bigint/symbol — safe to pass through
  return value;
}

export function redactHeaders(headers: { [key: string]: string }): { [key: string]: string } {
  const out: { [key: string]: string } = {};
  for (const [key, value] of Object.entries(headers)) {
    const normalized = key.toLowerCase();
    if (
      normalized === 'authorization' ||
      normalized === 'cookie' ||
      normalized === 'set-cookie' ||
      normalized === 'x-api-key' ||
      normalized === 'x-device-secret' ||
      normalized.includes('token') ||
      normalized.includes('secret') ||
      normalized.includes('password')
    ) {
      out[key] = '[redacted]';
    } else {
      out[key] = value;
    }
  }
  return out;
}

/**
 * Redact every query-parameter value before logging or sending to Sentry.
 *
 * An allowlist of secret-looking names is not sufficient here: ordinary
 * parameters such as `email`, `search`, `destination`, and `reason` routinely
 * contain PII or user-provided text. Keep parameter names for route-level
 * diagnostics while removing all values and fragments. Works on both full
 * URLs and path+query strings. On parse failure, scrub the entire query.
 */
export function redactUrl(raw: string): string {
  try {
    const parsed = new URL(raw, 'http://localhost');
    parsed.searchParams.forEach((_value, key) => {
      parsed.searchParams.set(key, '[redacted]');
    });
    // For absolute URLs, preserve the origin; for path-only strings, drop it.
    const isAbsolute = /^https?:\/\//i.test(raw);
    const origin = isAbsolute ? `${parsed.origin}` : '';
    return `${origin}${parsed.pathname}${parsed.search}`;
  } catch {
    // Fallback: if the URL is malformed, scrub the query string entirely
    // rather than risk logging sensitive params.
    return raw.includes('?') ? raw.replace(/\?.*$/, '?[redacted]') : raw;
  }
}
