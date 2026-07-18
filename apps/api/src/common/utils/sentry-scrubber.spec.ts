import { describe, expect, it } from 'vitest';

import { redactHeaders, redactUrl, scrubSentryEvent, sentryBeforeSend } from './sentry-scrubber';

describe('Sentry scrubbing', () => {
  it('removes Authorization, Cookie, and X-Api-Key headers', () => {
    const event = scrubSentryEvent({
      request: {
        headers: {
          Authorization: 'Bearer secret-token',
          Cookie: 'access_token=abc; refresh_token=def',
          'X-Api-Key': 'api-secret',
          'Content-Type': 'application/json',
        },
      },
    } as never);

    expect(event.request?.headers).toEqual({
      Authorization: '[redacted]',
      Cookie: '[redacted]',
      'X-Api-Key': '[redacted]',
      'Content-Type': 'application/json',
    });
  });

  it('redacts request body, cookies, and query string', () => {
    const event = scrubSentryEvent({
      request: {
        url: 'https://api.example.com/auth/reset-password?token=secret',
        data: { password: 'hunter2' },
        cookies: { session: 'abc' },
        query_string: 'token=secret',
      },
    } as never);

    expect(event.request?.data).toBe('[redacted]');
    expect(event.request?.cookies).toEqual({ _redacted: '[redacted]' });
    expect(event.request?.query_string).toBe('[redacted]');
    expect(event.request?.url).not.toContain('secret');
    expect(event.request?.url).toContain('token=%5Bredacted%5D');
  });

  it('strips user data down to id only', () => {
    const event = scrubSentryEvent({
      user: { id: 'user-1', email: 'person@example.com', ip_address: '1.2.3.4' },
    } as never);

    expect(event.user).toEqual({ id: 'user-1' });
  });

  it('redacts sensitive headers and urls in breadcrumbs', () => {
    const event = scrubSentryEvent({
      breadcrumbs: [
        {
          data: {
            headers: { Authorization: 'Bearer token' },
            url: 'https://api.example.com/path?key=secret',
          },
        },
      ],
    } as never);

    expect(event.breadcrumbs?.[0].data).toEqual({
      headers: { Authorization: '[redacted]' },
      url: 'https://api.example.com/path?key=%5Bredacted%5D',
    });
  });

  it('never drops the event when scrubbing throws', () => {
    const event = scrubSentryEvent({
      request: {
        headers: new Proxy({} as never, {
          get: () => {
            throw new Error('boom');
          },
        }),
      },
    } as never);
    expect(event).toBeDefined();
  });
});

describe('redactHeaders', () => {
  it('is case-insensitive and covers token/secret/password variants', () => {
    expect(
      redactHeaders({
        authorization: 'Bearer x',
        'X-Api-Key': 'k',
        'X-Device-Secret': 's',
        'Set-Cookie': 'c',
        'X-Custom-Token': 't',
        'X-Password-Reset': 'p',
        'X-Safe': 'safe',
      }),
    ).toEqual({
      authorization: '[redacted]',
      'X-Api-Key': '[redacted]',
      'X-Device-Secret': '[redacted]',
      'Set-Cookie': '[redacted]',
      'X-Custom-Token': '[redacted]',
      'X-Password-Reset': '[redacted]',
      'X-Safe': 'safe',
    });
  });
});

describe('sentryBeforeSend', () => {
  it('drops 4xx errors regardless of exception type', () => {
    const event = {
      exception: { values: [{ type: 'BadRequestException' }] },
      extra: { statusCode: 400 },
    } as unknown as Sentry.ErrorEvent;
    expect(sentryBeforeSend(event)).toBeNull();
  });

  it('drops 4xx errors from response context', () => {
    const event = {
      exception: { values: [{ type: 'Error' }] },
      contexts: { response: { status_code: 404 } },
    } as unknown as Sentry.ErrorEvent;
    expect(sentryBeforeSend(event)).toBeNull();
  });

  it('keeps 5xx errors after scrubbing', () => {
    const event = {
      exception: { values: [{ type: 'HttpException' }] },
      extra: { statusCode: 500 },
      request: { headers: { Authorization: 'Bearer secret' } },
    } as unknown as Sentry.ErrorEvent;
    const result = sentryBeforeSend(event);
    expect(result).not.toBeNull();
    expect(result?.request?.headers).toEqual({ Authorization: '[redacted]' });
  });
});

describe('redactUrl', () => {
  it('redacts all query values', () => {
    expect(redactUrl('https://api.example.com/path?token=secret&email=a@b.co')).toBe(
      'https://api.example.com/path?token=%5Bredacted%5D&email=%5Bredacted%5D',
    );
  });

  it('redacts relative path-only urls without adding a fake origin', () => {
    expect(redactUrl('/api/v1/path?token=secret')).toBe('/api/v1/path?token=%5Bredacted%5D');
  });

  it('falls back safely for malformed urls', () => {
    expect(redactUrl('http://[bad?token=secret')).toBe('http://[bad?[redacted]');
  });
});
