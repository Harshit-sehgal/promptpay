import { describe, expect, it, vi } from 'vitest';

import { RequestIdMiddleware } from './request-id.middleware';

function invoke(incoming?: string | string[]) {
  const headers: Record<string, string | string[]> = {};
  if (incoming !== undefined) headers['x-request-id'] = incoming;
  const req = { headers };
  const setHeader = vi.fn();
  const next = vi.fn();
  new RequestIdMiddleware().use(req as never, { setHeader } as never, next);
  return { req, setHeader, next };
}

describe('RequestIdMiddleware', () => {
  it('preserves a bounded opaque correlation id', () => {
    const result = invoke('client_request-123');
    expect(result.req.headers['x-request-id']).toBe('client_request-123');
    expect(result.setHeader).toHaveBeenCalledWith('x-request-id', 'client_request-123');
    expect(result.next).toHaveBeenCalledOnce();
  });

  it.each(['contains spaces', 'escape\u001bsequence', 'x'.repeat(65)])(
    'replaces unsafe inbound id %j',
    (unsafe) => {
      const result = invoke(unsafe);
      expect(result.req.headers['x-request-id']).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
      );
      expect(result.req.headers['x-request-id']).not.toBe(unsafe);
    },
  );

  it('replaces duplicate/array request-id headers instead of throwing', () => {
    const result = invoke(['first', 'second']);
    expect(result.req.headers['x-request-id']).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(result.next).toHaveBeenCalledOnce();
  });
});
