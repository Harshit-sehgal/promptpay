import { describe, expect, it } from 'vitest';

import { getErrorMessage } from './errors';

const TRANSIENT =
  'We could not reach the server. This is usually temporary — please try again in a moment.';

describe('getErrorMessage', () => {
  it('returns a real API rejection unchanged', () => {
    const err = { response: { status: 401, data: { message: 'Invalid credentials' } } };
    expect(getErrorMessage(err, 'Login failed')).toBe('Invalid credentials');
  });

  it('joins array messages (Nest validation pipes)', () => {
    const err = {
      response: { status: 400, data: { message: ['email must be an email', 'weak'] } },
    };
    expect(getErrorMessage(err, 'x')).toBe('email must be an email, weak');
  });

  it('falls back when there is no usable message', () => {
    expect(getErrorMessage({}, 'Login failed')).toBe('Login failed');
    expect(getErrorMessage(null, 'Login failed')).toBe('Login failed');
  });

  /**
   * The regression this file exists for: during a real outage the sign-in form
   * showed "Upstream API unavailable" — our own internal wording, and no help
   * to the person reading it.
   */
  it.each([502, 503, 504])('translates gateway status %i into guidance', (status) => {
    const err = { response: { status, data: { message: 'Upstream API unavailable' } } };
    expect(getErrorMessage(err, 'Login failed')).toBe(TRANSIENT);
  });

  it.each(['Upstream API unavailable', 'Upstream API timed out'])(
    'translates the internal string %s even with no status attached',
    (message) => {
      expect(getErrorMessage({ message }, 'Login failed')).toBe(TRANSIENT);
    },
  );

  it('never leaks internal upstream wording to a visitor', () => {
    const err = { response: { status: 502, data: { message: 'Upstream API unavailable' } } };
    expect(getErrorMessage(err, 'x')).not.toMatch(/upstream/i);
  });

  it('leaves other 5xx rejections alone — they may carry a real reason', () => {
    const err = { response: { status: 500, data: { message: 'Ledger reconciliation failed' } } };
    expect(getErrorMessage(err, 'x')).toBe('Ledger reconciliation failed');
  });
});
