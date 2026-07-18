import { describe, expect, it, vi } from 'vitest';
import { ArgumentsHost, HttpStatus } from '@nestjs/common';

import { Prisma } from '@waitlayer/db';

import { PrismaExceptionFilter } from './prisma-exception.filter';

describe('PrismaExceptionFilter', () => {
  it('does not log exception.message which may contain query parameters', () => {
    const filter = new PrismaExceptionFilter();
    const loggerSpy = vi.spyOn(filter['logger'], 'error').mockImplementation(() => {});

    const exception = new Prisma.PrismaClientKnownRequestError(
      'Unique constraint failed on the fields: (`email`) VALUES (person@example.com)',
      { clientVersion: '1.0.0' },
    );
    exception.code = 'P2002';

    const response = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
      headersSent: false,
    } as never;
    const request = { headers: { 'x-request-id': 'req-1' } } as never;
    const host = {
      switchToHttp: () => ({ getResponse: () => response, getRequest: () => request }),
    } as never;

    filter.catch(exception, host as ArgumentsHost);

    const logLine = loggerSpy.mock.calls[0][0] as string;
    expect(logLine).not.toContain('person@example.com');
    expect(logLine).not.toContain('VALUES');
    expect(logLine).toContain('code=P2002');
    expect(logLine).toContain('requestId=req-1');
    expect(logLine).toContain(`status=${HttpStatus.CONFLICT}`);
  });
});
