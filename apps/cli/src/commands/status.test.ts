import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { runStatus } from './status';

const mocks = vi.hoisted(() => {
  const api = {
    getBalance: vi.fn(),
    getOverview: vi.fn(),
  };
  return {
    api,
    creds: {
      apiUrl: 'https://api.waitlayer.com/api/v1',
      token: 'tok',
      email: 'dev@test.com',
      role: 'developer',
    },
  };
});

vi.mock('../lib/credentials', () => ({
  getCredentials: vi.fn(() => mocks.creds),
}));

vi.mock('../lib/api-client', () => ({
  ApiClient: class {
    getBalance = mocks.api.getBalance;
    getOverview = mocks.api.getOverview;
  },
}));

const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
const _exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {
  throw new Error('exit');
}) as never);

beforeEach(() => {
  vi.clearAllMocks();
  mocks.api.getBalance.mockResolvedValue({
    available: { amountMinor: 5000, currency: 'USD' },
    pending: { amountMinor: 2000, currency: 'USD' },
    total: { amountMinor: 50000, currency: 'USD' },
    paidOut: { amountMinor: 43000, currency: 'USD' },
  });
  mocks.api.getOverview.mockResolvedValue({
    estimatedEarnings: 5000,
    confirmedEarnings: 3000,
    pendingEarnings: 2000,
    lifetimeEarnings: 50000,
    trustLevel: 'normal',
    trustScore: 72,
  });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('runStatus', () => {
  it('prints earnings + account summary on success', async () => {
    await runStatus({ period: '7d' });
    expect(mocks.api.getBalance).toHaveBeenCalled();
    expect(mocks.api.getOverview).toHaveBeenCalled();
    const output = logSpy.mock.calls.map((c) => c[0]).join('\n');
    expect(output).toContain('WaitLayer Status');
    expect(output).toContain('Available');
    expect(output).toContain('Trust Level');
    expect(output).toContain('normal');
  });

  it('exits with a session-expired message on 401', async () => {
    mocks.api.getBalance.mockRejectedValue({ status: 401 });
    await expect(runStatus({})).rejects.toThrow('exit');
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('Session expired'));
  });

  it('exits with a generic error on non-401 failure', async () => {
    mocks.api.getOverview.mockRejectedValue(new Error('network down'));
    await expect(runStatus({})).rejects.toThrow('exit');
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('Failed to load status'));
  });
});
