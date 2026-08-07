// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { payoutApi } from '@/lib/api/services';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

import DevPayoutsPage from './page';

const { earningsAreLive } = vi.hoisted(() => ({ earningsAreLive: vi.fn() }));

vi.mock('@/components', () => ({
  LoadingSpinner: () => <div>Loading</div>,
  StatCard: ({ label }: { label: string }) => <div>{label}</div>,
  StatusBadge: ({ status }: { status: string }) => <span>{status}</span>,
}));

vi.mock('@/components/launch-mode-banner', () => ({
  earningsAreLive,
  useWaitLaunchMode: () => ({ mode: 'paused' }),
}));

vi.mock('@/lib/auth-context', () => ({
  useAuth: () => ({
    user: { emailVerified: true, twoFactorEnabled: true },
    isAuthenticated: true,
  }),
}));

vi.mock('@/lib/api/services', () => ({
  authApi: { requestEmailVerification: vi.fn() },
  payoutApi: {
    getInfo: vi.fn(),
    getHistory: vi.fn(),
    getProviders: vi.fn(),
    addMethod: vi.fn(),
    removeMethod: vi.fn(),
    createStripeConnectOnboarding: vi.fn(),
    requestPayout: vi.fn(),
  },
}));

const baseInfo = {
  payoutAccounts: [],
  availableBalanceMinor: 0n,
  availableBalanceByCurrency: { USD: 0n },
  minimumThresholdMinor: 1_000n,
  currency: 'USD',
  requiresTwoFactorForPayout: true,
  twoFactorEnabled: true,
};

const runtimeProviders = {
  providers: [
    {
      provider: 'manual',
      label: 'Manual',
      available: true,
      status: 'available',
      reasonCode: null,
      note: 'Available',
      reason: null,
    },
    {
      provider: 'stripe_connect',
      label: 'Stripe Connect',
      available: false,
      status: 'temporarily_disabled',
      reasonCode: 'operator_disabled',
      note: 'Requires setup',
      reason: 'Provider is temporarily disabled by operator.',
    },
  ],
};

describe('developer payout runtime readiness and removal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    earningsAreLive.mockReturnValue(false);
    vi.mocked(payoutApi.getInfo).mockResolvedValue({ data: baseInfo } as never);
    vi.mocked(payoutApi.getHistory).mockResolvedValue({ data: { payouts: [] } } as never);
    vi.mocked(payoutApi.getProviders).mockResolvedValue({ data: runtimeProviders } as never);
  });

  afterEach(() => cleanup());

  it('fails closed for registration while preserving payout information when readiness fails', async () => {
    vi.mocked(payoutApi.getProviders).mockRejectedValue(
      new Error('readiness endpoint unavailable'),
    );
    render(<DevPayoutsPage />);

    expect(await screen.findByText('Available balance')).toBeTruthy();
    expect(screen.getByText('Payout method registration is temporarily disabled.')).toBeTruthy();
    expect(
      (screen.getByRole('button', { name: '+ Add method' }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it('renders only live-ready providers as selectable', async () => {
    render(<DevPayoutsPage />);

    const add = await screen.findByRole('button', { name: '+ Add method' });
    await waitFor(() => expect((add as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(add);

    const manual = screen.getByRole('option', { name: 'Manual' }) as HTMLOptionElement;
    const stripe = screen.getByRole('option', {
      name: /Stripe Connect.*Temporarily unavailable/i,
    }) as HTMLOptionElement;
    expect(manual.disabled).toBe(false);
    expect(stripe.disabled).toBe(true);
    expect(screen.queryByRole('option', { name: /PayPal \(email\)/ })).toBeNull();
  });

  it('requires inline confirmation before removing a payout method', async () => {
    vi.mocked(payoutApi.getInfo).mockResolvedValue({
      data: {
        ...baseInfo,
        payoutAccounts: [
          {
            id: '550e8400-e29b-41d4-a716-446655440000',
            provider: 'manual',
            destination: 'Ending in 1234',
            currency: 'USD',
            isActive: true,
            isVerified: true,
            isFrozen: false,
          },
        ],
      },
    } as never);
    vi.mocked(payoutApi.removeMethod).mockResolvedValue({ data: { removed: true } } as never);
    render(<DevPayoutsPage />);

    fireEvent.click(await screen.findByRole('button', { name: 'Remove' }));
    expect(payoutApi.removeMethod).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Confirm removal' }));

    await waitFor(() =>
      expect(payoutApi.removeMethod).toHaveBeenCalledWith('550e8400-e29b-41d4-a716-446655440000'),
    );
    expect(await screen.findByText('Payout method removed.')).toBeTruthy();
  });

  it('does not offer removal while a payout account is fenced in-flight', async () => {
    vi.mocked(payoutApi.getInfo).mockResolvedValue({
      data: {
        ...baseInfo,
        payoutAccounts: [
          {
            id: '550e8400-e29b-41d4-a716-446655440000',
            provider: 'manual',
            destination: 'Ending in 1234',
            currency: 'USD',
            isActive: true,
            isVerified: true,
            isFrozen: false,
            initiationPayoutId: 'payout-in-flight',
          },
        ],
      },
    } as never);
    render(<DevPayoutsPage />);

    expect(await screen.findByText('Locked by payout in progress')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Remove' })).toBeNull();
  });

  it('disables both in-flight and operator-frozen methods in the request selector', async () => {
    earningsAreLive.mockReturnValue(true);
    vi.mocked(payoutApi.getInfo).mockResolvedValue({
      data: {
        ...baseInfo,
        availableBalanceMinor: 5_000n,
        availableBalanceByCurrency: { USD: 5_000n },
        payoutAccounts: [
          {
            id: '550e8400-e29b-41d4-a716-446655440001',
            provider: 'manual',
            destination: 'In progress',
            currency: 'USD',
            isActive: true,
            isVerified: true,
            isFrozen: false,
            initiationPayoutId: 'payout-in-flight',
          },
          {
            id: '550e8400-e29b-41d4-a716-446655440002',
            provider: 'manual',
            destination: 'Operator frozen',
            currency: 'USD',
            isActive: true,
            isVerified: true,
            isFrozen: true,
            initiationPayoutId: null,
          },
        ],
      },
    } as never);
    render(<DevPayoutsPage />);

    const inFlight = (await screen.findByRole('option', {
      name: /In progress.*payout in progress/i,
    })) as HTMLOptionElement;
    const operatorFrozen = screen.getByRole('option', {
      name: /Operator frozen.*operator frozen/i,
    }) as HTMLOptionElement;
    expect(inFlight.disabled).toBe(true);
    expect(operatorFrozen.disabled).toBe(true);
    expect(screen.getByText('Frozen by operator')).toBeTruthy();
  });
});
