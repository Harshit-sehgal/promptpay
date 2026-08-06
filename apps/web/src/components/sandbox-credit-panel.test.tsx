// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

const sandboxApiMock = vi.hoisted(() => ({
  getCredits: vi.fn(),
  claimFaucet: vi.fn(),
  simulatePayout: vi.fn(),
  listPayouts: vi.fn(),
}));

vi.mock('@/lib/api/services', () => ({ sandboxApi: sandboxApiMock }));

import SandboxCreditPanel from './sandbox-credit-panel';

describe('SandboxCreditPanel (WL-013/WL-070)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  it('renders the no-cash sandbox controls only after health verifies sandbox mode', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ environmentKind: 'sandbox' }), { status: 200 }),
    );
    sandboxApiMock.getCredits.mockResolvedValue({
      data: { mode: 'sandbox', hasCashValue: false, currency: 'XTS', balanceMinor: '1250' },
    });
    sandboxApiMock.listPayouts.mockResolvedValue({ data: { payouts: [] } });

    render(<SandboxCreditPanel />);

    expect(screen.queryByRole('heading', { name: /test credits/i })).toBeNull();
    expect(await screen.findByText('XTS only — no cash value, no external transfer.')).toBeTruthy();
    expect(screen.getByText('12.50 XTS')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Claim faucet grant' })).toBeTruthy();
  });

  it('does not call sandbox APIs or render controls in production mode', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ environmentKind: 'production' }), { status: 200 }),
    );

    render(<SandboxCreditPanel />);

    await waitFor(() => expect(sandboxApiMock.getCredits).not.toHaveBeenCalled());
    expect(screen.queryByRole('heading', { name: /test credits/i })).toBeNull();
  });
});
