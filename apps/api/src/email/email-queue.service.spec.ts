import { beforeEach, describe, expect, it, vi } from 'vitest';

import { PrismaService } from '../config/prisma.service';
import { EmailService } from './email.service';
import { EmailQueueService } from './email-queue.service';

const mockConfig = (secret?: string) =>
  ({
    get: vi.fn((key: string) => (key === 'EMAIL_QUEUE_SECRET' ? secret : undefined)),
  }) as unknown as import('@nestjs/config').ConfigService;

describe('EmailQueueService', () => {
  const mockPrisma = {
    emailQueue: {
      findUnique: vi.fn().mockResolvedValue(null),
      findUniqueOrThrow: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({ id: 'q-1' }),
      update: vi.fn().mockResolvedValue({ id: 'q-1' }),
    },
  } as unknown as PrismaService;

  const mockEmail = {
    send: vi.fn().mockResolvedValue({ delivered: true, driver: 'resend' }),
    buildEmailVerification: vi.fn().mockReturnValue({
      to: 'a@b.com',
      subject: 'Verify',
      html: '<p>verify</p>',
      text: 'verify',
      ttlMs: 24 * 60 * 60 * 1000,
    }),
    buildPasswordReset: vi.fn().mockReturnValue({
      to: 'a@b.com',
      subject: 'Reset',
      html: '<p>reset</p>',
      text: 'reset',
      ttlMs: 60 * 60 * 1000,
    }),
    buildPasswordChanged: vi.fn().mockReturnValue({
      to: 'a@b.com',
      subject: 'Changed',
      html: '<p>changed</p>',
      text: 'changed',
      ttlMs: 24 * 60 * 60 * 1000,
    }),
    buildAccountDeleted: vi.fn().mockReturnValue({
      to: 'a@b.com',
      subject: 'Deleted',
      html: '<p>deleted</p>',
      text: 'deleted',
      ttlMs: 24 * 60 * 60 * 1000,
    }),
    buildPayoutAccountFrozenAlert: vi.fn().mockReturnValue({
      to: 'a@b.com',
      subject: 'Payout account frozen',
      html: '<p>account frozen</p>',
      text: 'account frozen',
      ttlMs: 24 * 60 * 60 * 1000,
    }),
  } as unknown as EmailService;

  let service: EmailQueueService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new EmailQueueService(
      mockEmail,
      mockPrisma,
      mockConfig('test-email-queue-secret-32-bytes'),
    );
  });

  it('returns delivered=true when EmailService succeeds', async () => {
    const result = await service.enqueueOrSend({
      to: 'a@b.com',
      subject: 'Hello',
      html: '<p>hi</p>',
      text: 'hi',
    });
    expect(result.delivered).toBe(true);
    expect(mockEmail.send).toHaveBeenCalledTimes(1);
    expect(mockPrisma.emailQueue.findUnique).not.toHaveBeenCalled();
  });

  it('queues a failed send and returns delivered=true once persisted', async () => {
    mockEmail.send.mockResolvedValueOnce({ delivered: false, driver: 'resend' });
    const result = await service.enqueueOrSend({
      to: 'a@b.com',
      subject: 'Hello',
      html: '<p>hi</p>',
      text: 'hi',
    });
    expect(result.delivered).toBe(true);
    expect(mockPrisma.emailQueue.create).toHaveBeenCalledTimes(1);
    const args = mockPrisma.emailQueue.create.mock.calls[0][0];
    expect(args.data.contentHash).toBeDefined();
    expect(args.data.nextRetryAt.getTime()).toBeGreaterThan(Date.now());
  });

  it('encrypts html and text before persisting', async () => {
    mockEmail.send.mockResolvedValueOnce({ delivered: false, driver: 'resend' });
    await service.enqueueOrSend({
      to: 'a@b.com',
      subject: 'Hello',
      html: '<p>hi</p>',
      text: 'hi',
    });
    const args = mockPrisma.emailQueue.create.mock.calls[0][0];
    expect(args.data.html).not.toContain('<p>hi</p>');
    expect(args.data.text).not.toContain('hi');
    expect(args.data.html).toMatch(/^v1:/);
    expect(args.data.text).toMatch(/^v1:/);
  });

  it('round-trips encrypted payloads through decrypt()', async () => {
    const original = '<p>reset token: abc123</p>';
    const encrypted = service.encrypt(original);
    expect(encrypted).not.toContain('abc123');
    expect(service.decrypt(encrypted)).toBe(original);
  });

  it('decrypts legacy plaintext payloads during rollout', async () => {
    expect(service.decrypt('<p>plain</p>')).toBe('<p>plain</p>');
  });

  it('updates an existing row without resetting retry count (P2002 race recovery)', async () => {
    mockEmail.send.mockResolvedValueOnce({ delivered: false, driver: 'resend' });
    // enqueueOrSend now tries create first; on P2002 (contentHash
    // @unique race) it falls through to findUniqueOrThrow + update.
    mockPrisma.emailQueue.create.mockRejectedValueOnce({ code: 'P2002' });
    mockPrisma.emailQueue.findUniqueOrThrow.mockResolvedValueOnce({
      id: 'q-existing',
      contentHash: 'hash',
      retryCount: 3,
      nextRetryAt: new Date(Date.now() + 60_000),
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    });

    await service.enqueueOrSend({
      to: 'a@b.com',
      subject: 'Hello',
      html: '<p>hi</p>',
      text: 'hi',
    });

    expect(mockPrisma.emailQueue.create).toHaveBeenCalledTimes(1);
    expect(mockPrisma.emailQueue.update).toHaveBeenCalledTimes(1);
    const args = mockPrisma.emailQueue.update.mock.calls[0][0];
    expect(args.where.id).toBe('q-existing');
    expect(args.data.nextRetryAt).toBeDefined();
    expect(args.data.expiresAt).toBeDefined();
    expect(args.data.lastError).toBeNull();
  });

  it('delegates sendEmailVerification to enqueueOrSend', async () => {
    await service.sendEmailVerification('a@b.com', 'token-123');
    expect(mockEmail.buildEmailVerification).toHaveBeenCalledWith('a@b.com', 'token-123');
    expect(mockEmail.send).toHaveBeenCalled();
  });

  it('delegates sendPasswordReset to enqueueOrSend', async () => {
    await service.sendPasswordReset('a@b.com', 'token-123');
    expect(mockEmail.buildPasswordReset).toHaveBeenCalledWith('a@b.com', 'token-123');
    expect(mockEmail.send).toHaveBeenCalled();
  });

  it('delegates sendPasswordChanged to enqueueOrSend', async () => {
    await service.sendPasswordChanged('a@b.com');
    expect(mockEmail.buildPasswordChanged).toHaveBeenCalledWith('a@b.com');
    expect(mockEmail.send).toHaveBeenCalled();
  });

  it('delegates sendAccountDeleted to enqueueOrSend', async () => {
    await service.sendAccountDeleted('a@b.com');
    expect(mockEmail.buildAccountDeleted).toHaveBeenCalledWith('a@b.com');
    expect(mockEmail.send).toHaveBeenCalled();
  });

  it('delegates sendPayoutAccountFrozenAlert to enqueueOrSend', async () => {
    const metadata = {
      provider: 'wise',
      destination: 'wise-dest',
      currency: 'USD',
      actorRole: 'admin',
      reason: 'suspected takeover',
      time: '2026-07-15T00:00:00.000Z',
    };
    await service.sendPayoutAccountFrozenAlert('a@b.com', metadata);
    expect(mockEmail.buildPayoutAccountFrozenAlert).toHaveBeenCalledWith(
      'a@b.com',
      expect.objectContaining({ provider: 'wise', actorRole: 'admin' }),
    );
    expect(mockEmail.send).toHaveBeenCalled();
  });
});
