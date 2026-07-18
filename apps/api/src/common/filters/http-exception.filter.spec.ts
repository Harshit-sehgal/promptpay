import { describe, expect, it, vi } from 'vitest';
import { ArgumentsHost } from '@nestjs/common';

import { HttpExceptionFilter } from './http-exception.filter';

describe('HttpExceptionFilter', () => {
  it('logs 5xx exceptions with requestId for operator correlation', () => {
    const filter = new HttpExceptionFilter();
    const loggerSpy = vi.spyOn(filter['logger'], 'error').mockImplementation(() => {});

    const exception = new Error('database connection failed');
    const response = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
      headersSent: false,
      setHeader: vi.fn(),
      end: vi.fn(),
    } as never;
    const request = { headers: {} } as never;
    const host = {
      switchToHttp: () => ({ getResponse: () => response, getRequest: () => request }),
    } as never;

    filter.catch(exception, host as ArgumentsHost);

    expect(loggerSpy).toHaveBeenCalledWith(expect.stringContaining('database connection failed'));
  });

  it('redacts Authorization and Bearer tokens from logged stack traces', () => {
    const filter = new HttpExceptionFilter();
    const loggerSpy = vi.spyOn(filter['logger'], 'error').mockImplementation(() => {});

    const exception = new Error('external request failed');
    exception.stack =
      'Error: external request failed\n' +
      'at fn (Authorization: Bearer secret-token)\n' +
      'at fn (https://api.example.com/path?token=secret&key=other)\n' +
      'at fn (cookie: session=abc)\n' +
      'at fn (X-Api-Key: super-secret)\n' +
      'at fn (person@example.com)';

    const response = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
      headersSent: false,
      setHeader: vi.fn(),
      end: vi.fn(),
    } as never;
    const request = { headers: {} } as never;
    const host = {
      switchToHttp: () => ({ getResponse: () => response, getRequest: () => request }),
    } as never;

    filter.catch(exception, host as ArgumentsHost);

    const logLine = loggerSpy.mock.calls[0][0] as string;
    expect(logLine).not.toContain('secret-token');
    expect(logLine).not.toContain('super-secret');
    expect(logLine).not.toContain('session=abc');
    expect(logLine).not.toContain('person@example.com');
    expect(logLine).toContain('Authorization: [redacted]');
    expect(logLine).not.toContain('Bearer secret-token');
    expect(logLine).toContain('X-Api-Key: [redacted]');
    expect(logLine).toContain('cookie: [redacted]');
    expect(logLine).toContain('[email]');
  });

  it('does not scrub inline question marks in non-URL error text', () => {
    const filter = new HttpExceptionFilter();
    const loggerSpy = vi.spyOn(filter['logger'], 'error').mockImplementation(() => {});

    const exception = new Error('what happened?');
    exception.stack = 'Error: what happened?\nat fn (internal/file.ts:1:1)';

    const response = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
      headersSent: false,
      setHeader: vi.fn(),
      end: vi.fn(),
    } as never;
    const request = { headers: {} } as never;
    const host = {
      switchToHttp: () => ({ getResponse: () => response, getRequest: () => request }),
    } as never;

    filter.catch(exception, host as ArgumentsHost);

    const logLine = loggerSpy.mock.calls[0][0] as string;
    expect(logLine).toContain('what happened?');
  });
});
