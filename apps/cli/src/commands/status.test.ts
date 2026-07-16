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
    available: { amountMinor: 5000n, currency: 'USD', byCurrency: { USD: 5000n } },
    pending: { amountMinor: 2000n, currency: 'USD', byCurrency: { USD: 2000n } },
    total: { amountMinor: 50000n, currency: 'USD', byCurrency: { USD: 50000n } },
    paidOut: { amountMinor: 43000n, currency: 'USD', byCurrency: { USD: 43000n } },
  });
  mocks.api.getOverview.mockResolvedValue({
    estimatedEarnings: 5000n,
    confirmedEarnings: 3000n,
    pendingEarnings: 2000n,
    lifetimeEarnings: 50000n,
    estimatedEarningsByCurrency: { USD: 5000n },
    confirmedEarningsByCurrency: { USD: 3000n },
    pendingEarningsByCurrency: { USD: 2000n },
    lifetimeEarningsByCurrency: { USD: 50000n },
    trustLevel: 'normal',
    trustScore: 72,
  });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('runStatus', () => {
  it('prints earnings + account summary on success', async () => {
    await runStatus();
    expect(mocks.api.getBalance).toHaveBeenCalledWith();
    expect(mocks.api.getOverview).toHaveBeenCalledWith();
    const output = logSpy.mock.calls.map((c) => c[0]).join('\n');
    expect(output).toContain('WaitLayer Status');
    expect(output).toContain('Available');
    expect(output).toContain('Trust Level');
    expect(output).toContain('normal');
  });

  it('uses one lifetime currency and selects every amount from its currency map', async () => {
    mocks.api.getBalance.mockResolvedValue({
      available: { amountMinor: 5000n, currency: 'USD', byCurrency: { USD: 5000n, EUR: 125n } },
      pending: { amountMinor: 2400n, currency: 'EUR', byCurrency: { USD: 50n, EUR: 2400n } },
      total: { amountMinor: 9000n, currency: 'EUR', byCurrency: { USD: 1000n, EUR: 9000n } },
      paidOut: { amountMinor: 10000n, currency: 'USD', byCurrency: { USD: 10000n, EUR: 3500n } },
    });
    mocks.api.getOverview.mockResolvedValue({
      estimatedEarnings: 6000n,
      confirmedEarnings: 5000n,
      pendingEarnings: 2400n,
      lifetimeEarnings: 9000n,
      estimatedEarningsByCurrency: { USD: 6000n, EUR: 425n },
      confirmedEarningsByCurrency: { USD: 5000n, EUR: 125n },
      pendingEarningsByCurrency: { USD: 50n, EUR: 2400n },
      lifetimeEarningsByCurrency: { USD: 1000n, EUR: 9000n },
      trustLevel: 'normal',
      trustScore: 72,
    });

    await runStatus();

    const output = logSpy.mock.calls.map((call) => call[0]).join('\n');
    expect(output).toContain('Available:  €1.25');
    expect(output).toContain('Pending:    €24.00');
    expect(output).toContain('Paid out:   €35.00');
    expect(output).toContain('Est. Earnings:  €4.25');
    expect(output).toContain('Confirmed:      €1.25');
    expect(output).not.toContain('$50.00');
    expect(output).not.toContain('$60.00');
  });

  it('prints balances above Number.MAX_SAFE_INTEGER without losing cents', async () => {
    const exact = 9_007_199_254_740_993n;
    mocks.api.getBalance.mockResolvedValue({
      available: { amountMinor: exact, currency: 'USD', byCurrency: { USD: exact } },
      pending: { amountMinor: 0n, currency: 'USD', byCurrency: { USD: 0n } },
      total: { amountMinor: exact, currency: 'USD', byCurrency: { USD: exact } },
      paidOut: { amountMinor: 0n, currency: 'USD', byCurrency: { USD: 0n } },
    });
    mocks.api.getOverview.mockResolvedValue({
      estimatedEarnings: exact,
      confirmedEarnings: exact,
      pendingEarnings: 0n,
      lifetimeEarnings: exact,
      estimatedEarningsByCurrency: { USD: exact },
      confirmedEarningsByCurrency: { USD: exact },
      pendingEarningsByCurrency: { USD: 0n },
      lifetimeEarningsByCurrency: { USD: exact },
      trustLevel: 'normal',
      trustScore: 72,
    });

    await runStatus();

    const output = logSpy.mock.calls.map((call) => call[0]).join('\n');
    expect(output).toContain('$90,071,992,547,409.93');
  });

  it('exits with a session-expired message on 401', async () => {
    mocks.api.getBalance.mockRejectedValue({ status: 401 });
    await expect(runStatus()).rejects.toThrow('exit');
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('Session expired'));
  });

  it('exits with a generic error on non-401 failure', async () => {
    mocks.api.getOverview.mockRejectedValue(new Error('network down'));
    await expect(runStatus()).rejects.toThrow('exit');
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('Failed to load status'));
  });
});
