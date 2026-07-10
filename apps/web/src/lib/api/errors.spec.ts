import { describe, expect, it } from 'vitest';

import { getErrorMessage } from './errors';

describe('getErrorMessage', () => {
  it('prefers response.data.message when present', () => {
    const err = { response: { data: { message: 'Invalid token' } } };
    expect(getErrorMessage(err, 'fallback')).toBe('Invalid token');
  });

  it('falls back to error.message when response is absent', () => {
    const err = { message: 'Network error' };
    expect(getErrorMessage(err, 'fallback')).toBe('Network error');
  });

  it('joins array messages with a comma', () => {
    const err = { response: { data: { message: ['First', 'Second'] } } };
    expect(getErrorMessage(err, 'fallback')).toBe('First, Second');
  });

  it('returns the fallback when no message is available', () => {
    const err = { response: { data: {} } };
    expect(getErrorMessage(err, 'fallback')).toBe('fallback');
  });

  it('returns the fallback for a null error instead of throwing', () => {
    expect(getErrorMessage(null, 'fallback')).toBe('fallback');
  });

  it('returns the fallback for an undefined error instead of throwing', () => {
    expect(getErrorMessage(undefined, 'fallback')).toBe('fallback');
  });
});
