import { throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { ExecutionContext, Logger } from '@nestjs/common';

import { LoggingInterceptor, redactUrl } from './logging.interceptor';

describe('redactUrl', () => {
  it('redacts ordinary PII-bearing query values as well as explicit secrets', () => {
    const redacted = redactUrl(
      '/api/v1/admin/users?search=person%40example.com&token=secret-value&page=2',
    );

    expect(redacted).toContain('search=%5Bredacted%5D');
    expect(redacted).toContain('token=%5Bredacted%5D');
    expect(redacted).toContain('page=%5Bredacted%5D');
    expect(redacted).not.toContain('person%40example.com');
    expect(redacted).not.toContain('secret-value');
  });

  it('preserves the path and removes URL fragments', () => {
    expect(redactUrl('/api/v1/health')).toBe('/api/v1/health');
    expect(redactUrl('https://api.example.test/path?q=value#private')).toBe(
      'https://api.example.test/path?q=%5Bredacted%5D',
    );
  });

  it('fails closed for malformed URLs with a query string', () => {
    expect(redactUrl('http://[invalid?email=person@example.com')).toBe(
      'http://[invalid?[redacted]',
    );
  });
});

describe('LoggingInterceptor error logging', () => {
  it('does not include raw error messages in access logs', () => {
    const interceptor = new LoggingInterceptor();
    const loggerSpy = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => {});

    const request = {
      method: 'POST',
      url: '/api/v1/auth/login',
      headers: { 'x-request-id': 'req-1' },
    };
    const response = { statusCode: 500 };
    const context = {
      switchToHttp: () => ({ getRequest: () => request, getResponse: () => response }),
    } as unknown as ExecutionContext;

    const error = new Error('database connection failed: password=secret');
    const handler = { handle: () => throwError(() => error) };

    let thrown = false;
    interceptor.intercept(context, handler).subscribe({
      next: () => {},
      error: () => {
        thrown = true;
      },
    });

    expect(thrown).toBe(true);
    expect(loggerSpy).toHaveBeenCalledTimes(1);
    const logLine = loggerSpy.mock.calls[0][0] as string;
    expect(logLine).not.toContain('password=secret');
    expect(logLine).toContain('requestId=req-1');
    expect(logLine).toContain('POST /api/v1/auth/login 500');

    loggerSpy.mockRestore();
  });
});
