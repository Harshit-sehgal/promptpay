/**
 * Gateway statuses that always mean "we could not reach our own backend".
 * They are never an actionable API rejection, so the raw text is useless to a
 * visitor no matter which screen raised it.
 */
const TRANSIENT_STATUSES = new Set([502, 503, 504]);

/**
 * The BFF's internal upstream strings (`app/api/auth/_lib/upstream.ts`). These
 * reached the sign-in form verbatim during a real outage — a visitor was shown
 * "Upstream API unavailable", which names our internals and tells them nothing
 * about what to do. Matched as a fallback for the case where no status is
 * attached to the error.
 */
const TRANSIENT_UPSTREAM_MESSAGES = new Set(['Upstream API unavailable', 'Upstream API timed out']);

const TRANSIENT_MESSAGE =
  'We could not reach the server. This is usually temporary — please try again in a moment.';

export function getErrorMessage(error: unknown, fallback: string): string {
  const candidate = (error ?? {}) as {
    response?: { status?: unknown; data?: { message?: unknown } };
    message?: unknown;
  };
  const status = candidate.response?.status;
  const message = candidate.response?.data?.message ?? candidate.message;

  if (typeof status === 'number' && TRANSIENT_STATUSES.has(status)) return TRANSIENT_MESSAGE;
  if (typeof message === 'string' && TRANSIENT_UPSTREAM_MESSAGES.has(message)) {
    return TRANSIENT_MESSAGE;
  }

  if (Array.isArray(message)) return message.join(', ');
  if (typeof message === 'string') return message;
  return fallback;
}
