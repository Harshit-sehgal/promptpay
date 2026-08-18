import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { runSandbox } from './sandbox';

const mocks = vi.hoisted(() => ({
  api: {
    getEnvironmentIdentity: vi.fn(),
    claimSandboxFaucet: vi.fn(),
    simulateSandboxPayout: vi.fn(),
    getSandboxCredits: vi.fn(),
    listSandboxPayouts: vi.fn(),
  },
  creds: {
    email: 'dev@test.com',
    accessToken: 'access-token',
    refreshToken: 'refresh-token',
    userId: 'user-1',
    role: 'developer',
  },
}));

vi.mock('../lib/credentials', () => ({
  getCredentials: vi.fn(() => mocks.creds),
}));

vi.mock('../lib/api-client', () => ({
  ApiClient: class {
    getEnvironmentIdentity = mocks.api.getEnvironmentIdentity;
    claimSandboxFaucet = mocks.api.claimSandboxFaucet;
    simulateSandboxPayout = mocks.api.simulateSandboxPayout;
    getSandboxCredits = mocks.api.getSandboxCredits;
    listSandboxPayouts = mocks.api.listSandboxPayouts;
  },
}));

const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);

beforeEach(() => {
  vi.clearAllMocks();
  process.exitCode = undefined;
  mocks.api.getEnvironmentIdentity.mockResolvedValue({
    environmentKind: 'sandbox',
    environmentId: 'sandbox-local',
  });
  mocks.api.claimSandboxFaucet.mockResolvedValue({
    mode: 'sandbox',
    hasCashValue: false,
    currency: 'XTS',
    balanceMinor: '10000',
    grantedMinor: 10000,
    duplicate: false,
    exhausted: false,
    environmentId: 'sandbox-local',
  });
  mocks.api.simulateSandboxPayout.mockResolvedValue({
    mode: 'sandbox',
    hasCashValue: false,
    simulationId: 'simulation-1',
    status: 'paid',
    amountMinor: '1000',
    currency: 'XTS',
    balanceMinor: '9000',
    providerTxId: 'sandbox_paid_simulation-1',
    duplicate: false,
    environmentId: 'sandbox-local',
  });
  mocks.api.getSandboxCredits.mockResolvedValue({
    mode: 'sandbox',
    hasCashValue: false,
    currency: 'XTS',
    balanceMinor: '10000',
    environmentId: 'sandbox-local',
  });
  mocks.api.listSandboxPayouts.mockResolvedValue({
    mode: 'sandbox',
    hasCashValue: false,
    environmentId: 'sandbox-local',
    payouts: [],
  });
});

afterEach(() => {
  process.exitCode = undefined;
});

describe('runSandbox', () => {
  it('defaults to status and requires the server to confirm sandbox mode', async () => {
    await runSandbox();

    expect(mocks.api.getEnvironmentIdentity).toHaveBeenCalledOnce();
    expect(mocks.api.getSandboxCredits).toHaveBeenCalledOnce();
    expect(mocks.api.listSandboxPayouts).toHaveBeenCalledOnce();
    expect(logSpy.mock.calls.map((call) => call[0]).join('\n')).toContain('sandbox-local');
  });

  it('fails closed when the server is not a test or sandbox environment', async () => {
    mocks.api.getEnvironmentIdentity.mockResolvedValue({
      environmentKind: 'production',
      environmentId: 'production',
    });

    await runSandbox({ action: 'status' });

    expect(process.exitCode).toBe(1);
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('Sandbox commands require a sandbox/test API'),
    );
    expect(mocks.api.getSandboxCredits).not.toHaveBeenCalled();
  });

  it('claims the faucet with a generated idempotency key', async () => {
    await runSandbox({ action: 'faucet' });

    expect(mocks.api.claimSandboxFaucet).toHaveBeenCalledWith(
      expect.stringMatching(/^cli-faucet-[0-9a-f-]{36}$/),
    );
    expect(logSpy.mock.calls.map((call) => call[0]).join('\n')).toContain('10000');
  });

  it('preserves an explicit faucet idempotency key', async () => {
    await runSandbox({ action: 'faucet', idempotencyKey: 'fixture-faucet-1' });

    expect(mocks.api.claimSandboxFaucet).toHaveBeenCalledWith('fixture-faucet-1');
  });

  it('validates payout amounts before contacting the API', async () => {
    await runSandbox({
      action: 'payout',
      amountMinor: '100000000000000000000',
      destinationAlias: 'sandbox:demo',
      outcome: 'paid',
    });

    expect(process.exitCode).toBe(1);
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('--amount-minor must be an integer'),
    );
    expect(mocks.api.getEnvironmentIdentity).not.toHaveBeenCalled();
  });

  it('sends a bounded exact payout amount and explicit outcome', async () => {
    await runSandbox({
      action: 'payout',
      amountMinor: '001000',
      destinationAlias: 'sandbox:demo',
      outcome: 'reconciliation_escalation',
      idempotencyKey: 'fixture-payout-1',
    });

    expect(mocks.api.simulateSandboxPayout).toHaveBeenCalledWith({
      amountMinor: 1000,
      destinationAlias: 'sandbox:demo',
      outcome: 'reconciliation_escalation',
      idempotencyKey: 'fixture-payout-1',
    });
  });

  it('rejects destinations outside the sandbox alias format', async () => {
    await runSandbox({
      action: 'payout',
      amountMinor: '1000',
      destinationAlias: 'paypal:demo',
      outcome: 'paid',
    });

    expect(process.exitCode).toBe(1);
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('--destination must be a sandbox:<alias> value'),
    );
    expect(mocks.api.getEnvironmentIdentity).not.toHaveBeenCalled();
  });
});
