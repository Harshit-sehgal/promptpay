// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

const sandboxApiMock = vi.hoisted(() => ({
  listDeposits: vi.fn(),
  simulateDeposit: vi.fn(),
}));

vi.mock('@/lib/api/services', () => ({ sandboxApi: sandboxApiMock }));

import SandboxDepositPanel from './sandbox-deposit-panel';

describe('SandboxDepositPanel (WL-070)', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  it('renders advertiser deposit simulation only after sandbox health verification', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ environmentKind: 'sandbox' }), { status: 200 }),
    );
    sandboxApiMock.listDeposits.mockResolvedValue({ data: { deposits: [] } });

    render(<SandboxDepositPanel />);

    expect(screen.queryByRole('heading', { name: /test advertiser deposit/i })).toBeNull();
    expect(await screen.findByRole('heading', { name: /test advertiser deposit/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Record deposit' })).toBeTruthy();
  });

  it('does not call sandbox APIs in production mode', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ environmentKind: 'production' }), { status: 200 }),
    );

    render(<SandboxDepositPanel />);

    await waitFor(() => expect(sandboxApiMock.listDeposits).not.toHaveBeenCalled());
    expect(screen.queryByRole('heading', { name: /test advertiser deposit/i })).toBeNull();
  });
});
