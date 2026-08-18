import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./commands/sandbox', () => ({
  runSandbox: vi.fn(),
}));

import { runSandbox } from './commands/sandbox';
import { program } from './index';

describe('waitlayer sandbox commander wiring', () => {
  beforeEach(() => {
    vi.mocked(runSandbox).mockReset();
  });

  it('maps --destination to destinationAlias for sandbox payout', async () => {
    await program.parseAsync(
      [
        'sandbox',
        'payout',
        '--destination',
        'sandbox:demo',
        '--amount-minor',
        '100',
        '--outcome',
        'paid',
      ],
      { from: 'user' },
    );
    expect(runSandbox).toHaveBeenCalledTimes(1);
    expect(runSandbox).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'payout',
        destinationAlias: 'sandbox:demo',
        amountMinor: '100',
        outcome: 'paid',
      }),
    );
  });

  it('passes an omitted destination through as undefined', async () => {
    await program.parseAsync(['sandbox', 'status'], { from: 'user' });
    expect(runSandbox).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'status', destinationAlias: undefined }),
    );
  });
});
