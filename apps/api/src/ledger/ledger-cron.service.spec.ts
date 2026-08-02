import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { LedgerCronService } from './ledger-cron.service';

vi.mock('../common/utils/background-jobs', () => ({
  backgroundJobsEnabled: vi.fn(() => true),
}));

vi.mock('../common/utils/cron-lease', () => ({
  acquireCronLease: vi.fn(),
  renewCronLease: vi.fn(),
}));

import { acquireCronLease, renewCronLease } from '../common/utils/cron-lease';

function makeService(mature = vi.fn().mockResolvedValue({ matured: 0 })) {
  return new LedgerCronService(
    { matureEarnings: mature } as never,
    { $queryRaw: vi.fn() } as never,
  );
}

describe('LedgerCronService', () => {
  beforeEach(() => {
    vi.mocked(acquireCronLease).mockResolvedValue(true);
    vi.mocked(renewCronLease).mockResolvedValue(true);
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  it('matures earnings when the lease is acquired', async () => {
    const mature = vi.fn().mockResolvedValue({ matured: 3 });
    const svc = makeService(mature);
    await (svc as unknown as { runMaturation(): Promise<void> }).runMaturation();

    expect(mature).toHaveBeenCalledOnce();
  });

  it('skips maturation when another replica holds the lease', async () => {
    vi.mocked(acquireCronLease).mockResolvedValue(false);
    const mature = vi.fn().mockResolvedValue({ matured: 0 });
    const svc = makeService(mature);
    await (svc as unknown as { runMaturation(): Promise<void> }).runMaturation();

    expect(mature).not.toHaveBeenCalled();
  });

  it('does not run overlapping maturation batches', async () => {
    const svc = makeService();
    const runner = svc as unknown as { running: boolean; runMaturation(): Promise<void> };
    runner.running = true;
    await runner.runMaturation();
    runner.running = false;
  });

  it('renews the lease while a batch runs and clears the heartbeat', async () => {
    process.env.LEDGER_MATURATION_INTERVAL_MS = '15000';
    vi.useFakeTimers();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const svc = makeService(vi.fn().mockImplementation(() => gate.then(() => ({ matured: 1 }))));
    const runner = svc as unknown as { runMaturation(): Promise<void> };

    const pending = runner.runMaturation();
    await vi.advanceTimersByTimeAsync(20_001);
    expect(renewCronLease).toHaveBeenCalled();
    release();
    await pending;
    delete process.env.LEDGER_MATURATION_INTERVAL_MS;
  });

  it('releases the running flag when maturation throws', async () => {
    const svc = makeService(vi.fn().mockRejectedValue(new Error('boom')));
    const runner = svc as unknown as { running: boolean; runMaturation(): Promise<void> };
    await runner.runMaturation();
    expect(runner.running).toBe(false);
  });
});
