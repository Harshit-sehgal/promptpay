// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { authApi } from '@/lib/api/services';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

import { TwoFactorEnrolment } from './two-factor-enrolment';

vi.mock('qrcode', () => ({
  default: { toDataURL: vi.fn().mockResolvedValue('data:image/png;base64,qr') },
}));

vi.mock('@/lib/api/services', () => ({
  authApi: {
    forgotPassword: vi.fn(),
    setup2fa: vi.fn(),
    enable2fa: vi.fn(),
    disable2fa: vi.fn(),
    regenerate2faBackupCodes: vi.fn(),
  },
}));

describe('TwoFactorEnrolment', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(authApi.setup2fa).mockResolvedValue({
      data: { secret: 'TESTSECRET', otpauthUrl: 'otpauth://totp/WaitLayer:test' },
    } as never);
    vi.mocked(authApi.enable2fa).mockResolvedValue({
      data: {
        twoFactorEnabled: true,
        backupCodes: ['ABCD-EFGH-JKMN', 'PQRS-TUVW-XYZ2'],
      },
    } as never);
  });

  afterEach(() => cleanup());

  it('uses a password proof, shows one-time backup codes, and flags admin re-login', async () => {
    const onChange = vi.fn();
    const onEnrollmentRequiresRelogin = vi.fn();
    render(
      <TwoFactorEnrolment
        hasPassword
        accountEmail="admin@example.com"
        onChange={onChange}
        onEnrollmentRequiresRelogin={onEnrollmentRequiresRelogin}
      />,
    );

    fireEvent.change(screen.getByLabelText('Current password'), {
      target: { value: 'correct-horse-battery' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Enable 2FA' }));

    await waitFor(() =>
      expect(authApi.setup2fa).toHaveBeenCalledWith({
        currentPassword: 'correct-horse-battery',
      }),
    );
    fireEvent.change(await screen.findByLabelText('Authentication code'), {
      target: { value: '123456' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Verify and enable' }));

    expect(await screen.findByText('ABCD-EFGH-JKMN')).toBeTruthy();
    expect(screen.getByText('PQRS-TUVW-XYZ2')).toBeTruthy();
    expect(onChange).toHaveBeenCalledWith(true);
    expect(onEnrollmentRequiresRelogin).toHaveBeenCalledTimes(1);
    expect(
      (screen.getByRole('button', { name: 'I saved them; hide codes' }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });

  it('gives a Google-only account a signed email path instead of a support dead end', async () => {
    vi.mocked(authApi.forgotPassword).mockResolvedValue({ data: { ok: true } } as never);
    render(<TwoFactorEnrolment hasPassword={false} accountEmail="google-user@example.com" />);

    expect(screen.queryByLabelText('Current password')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Email me a password setup link' }));

    await waitFor(() =>
      expect(authApi.forgotPassword).toHaveBeenCalledWith('google-user@example.com'),
    );
    expect(screen.getByText(/password setup email is on its way/i)).toBeTruthy();
  });

  it('delegates backup-code regeneration to the shared TOTP-or-backup step-up flow', async () => {
    vi.mocked(authApi.regenerate2faBackupCodes).mockResolvedValue({
      data: { backupCodes: ['2345-6789-ABCD'] },
    } as never);
    render(<TwoFactorEnrolment initialEnabled hasPassword accountEmail="dev@example.com" />);

    fireEvent.click(screen.getByRole('button', { name: 'Regenerate backup codes' }));
    expect(screen.getByText(/continue to securely confirm/i)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Generate new codes' }));

    expect(await screen.findByText('2345-6789-ABCD')).toBeTruthy();
    expect(authApi.regenerate2faBackupCodes).toHaveBeenCalledWith();
    expect(screen.getByText(/previous codes no longer work/i)).toBeTruthy();
  });

  it('disables 2FA through one shared step-up instead of collecting a second TOTP', async () => {
    vi.mocked(authApi.disable2fa).mockResolvedValue({
      data: { twoFactorEnabled: false },
    } as never);
    render(<TwoFactorEnrolment initialEnabled hasPassword accountEmail="dev@example.com" />);

    fireEvent.click(screen.getByRole('button', { name: 'Disable 2FA' }));
    expect(screen.queryByLabelText('Authentication code')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Confirm disable' }));

    await waitFor(() => expect(authApi.disable2fa).toHaveBeenCalledWith());
    expect(screen.getByText(/two-factor authentication disabled/i)).toBeTruthy();
  });
});
