import { createHash } from 'crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BadRequestException } from '@nestjs/common';

import { ComplianceService } from './compliance.service';

const mockPrisma = {
  consent: {
    create: vi.fn(),
    findFirst: vi.fn(),
    update: vi.fn(),
    count: vi.fn(),
  },
  $executeRaw: vi.fn().mockResolvedValue(1),
  $transaction: vi.fn((callback: (tx: any) => unknown) => callback(mockPrisma)),
} as any;

const audit = {
  log: vi.fn().mockResolvedValue(undefined),
  logStrict: vi.fn().mockResolvedValue(undefined),
} as any;

function makeService() {
  return new ComplianceService(mockPrisma, audit);
}

const VISITOR = 'f47ac10b-58cc-4372-a567-0e02b2c3d479';
const VISITOR_HASH = createHash('sha256').update(VISITOR).digest('hex');

describe('ComplianceService — anonymous (logged-out) consent (A-009)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.consent.findFirst.mockResolvedValue(null);
    mockPrisma.consent.count.mockResolvedValue(0);
  });

  it('records a null-user consent with a hashed visitorId on accept', async () => {
    const service = makeService();
    mockPrisma.consent.create.mockResolvedValue({
      id: 'c-1',
      userId: null,
      visitorIdHash: VISITOR_HASH,
      purpose: 'marketing_cookies',
      version: '2026-07-01',
      granted: true,
    });

    const row = await service.recordAnonymousConsent({
      visitorId: VISITOR,
      purpose: 'marketing_cookies',
      granted: true,
    });

    expect(row.visitorIdHash).toBe(VISITOR_HASH);
    expect(mockPrisma.consent.create).toHaveBeenCalledTimes(1);
    const data = mockPrisma.consent.create.mock.calls[0][0].data;
    expect(data.userId).toBeNull();
    expect(data.visitorIdHash).toBe(VISITOR_HASH);
    expect(data.purpose).toBe('marketing_cookies');
    // Defaults to the current required version when omitted.
    expect(data.version).toBe('2026-07-01');
    expect(data.granted).toBe(true);
    expect(audit.logStrict).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'consent_granted', actorId: 'anonymous' }),
      expect.anything(),
    );
  });

  it('records granted:false for a declined anonymous choice', async () => {
    const service = makeService();
    mockPrisma.consent.create.mockResolvedValue({
      id: 'c-2',
      userId: null,
      visitorIdHash: VISITOR_HASH,
      purpose: 'marketing_cookies',
      version: '2026-07-01',
      granted: false,
    });

    const row = await service.recordAnonymousConsent({
      visitorId: VISITOR,
      purpose: 'marketing_cookies',
      granted: false,
    });

    expect(row.granted).toBe(false);
    const data = mockPrisma.consent.create.mock.calls[0][0].data;
    expect(data.granted).toBe(false);
    expect(audit.logStrict).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'consent_revoked', actorId: 'anonymous' }),
      expect.anything(),
    );
  });

  it('rejects an invalid (unsupported) consent purpose', async () => {
    const service = makeService();
    await expect(
      service.recordAnonymousConsent({ visitorId: VISITOR, purpose: 'not_a_real_purpose' }),
    ).rejects.toThrow(BadRequestException);
    expect(mockPrisma.consent.create).not.toHaveBeenCalled();
  });

  it('rejects a client-supplied stale or invented policy version', async () => {
    const service = makeService();
    await expect(
      service.recordAnonymousConsent({
        visitorId: VISITOR,
        purpose: 'marketing_cookies',
        policyVersion: '2099-01-01',
      }),
    ).rejects.toThrow('not current');
    expect(mockPrisma.consent.create).not.toHaveBeenCalled();
  });

  it('appends a changed anonymous choice instead of mutating prior legal evidence', async () => {
    const service = makeService();
    mockPrisma.consent.findFirst.mockResolvedValue({
      id: 'c-existing',
      userId: null,
      visitorIdHash: VISITOR_HASH,
      purpose: 'marketing_cookies',
      version: '2026-07-01',
      granted: false,
    });
    mockPrisma.consent.create.mockResolvedValue({
      id: 'c-new-choice',
      userId: null,
      visitorIdHash: VISITOR_HASH,
      purpose: 'marketing_cookies',
      version: '2026-07-01',
      granted: true,
    });

    await service.recordAnonymousConsent({
      visitorId: VISITOR,
      purpose: 'marketing_cookies',
      granted: true,
    });

    expect(mockPrisma.consent.update).not.toHaveBeenCalled();
    expect(mockPrisma.consent.create).toHaveBeenCalledTimes(1);
    expect(mockPrisma.consent.create.mock.calls[0][0].data.granted).toBe(true);
    expect(mockPrisma.consent.findFirst).toHaveBeenCalledWith({
      where: { visitorIdHash: VISITOR_HASH, purpose: 'marketing_cookies' },
      orderBy: { createdAt: 'desc' },
    });
  });

  it('returns the latest row without appending on an exact replay', async () => {
    const service = makeService();
    const existing = {
      id: 'c-existing',
      userId: null,
      visitorIdHash: VISITOR_HASH,
      purpose: 'marketing_cookies',
      version: '2026-07-01',
      granted: false,
    };
    mockPrisma.consent.findFirst.mockResolvedValue(existing);

    await expect(
      service.recordAnonymousConsent({
        visitorId: VISITOR,
        purpose: 'marketing_cookies',
        granted: false,
      }),
    ).resolves.toBe(existing);
    expect(mockPrisma.$executeRaw).toHaveBeenCalled();
    expect(mockPrisma.consent.create).not.toHaveBeenCalled();
    expect(audit.logStrict).not.toHaveBeenCalled();
  });

  it('does not store the raw visitorId — only its hash', async () => {
    const service = makeService();
    mockPrisma.consent.create.mockResolvedValue({ id: 'c-3', userId: null });

    await service.recordAnonymousConsent({ visitorId: VISITOR, purpose: 'marketing_cookies' });

    const data = mockPrisma.consent.create.mock.calls[0][0].data;
    expect(data.visitorIdHash).toBe(VISITOR_HASH);
    // No field carries the plaintext id.
    expect(JSON.stringify(data)).not.toContain(VISITOR);
  });
});

describe('ComplianceService — stale consent semantics', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.consent.count.mockResolvedValue(0);
  });

  it('honours a current explicit marketing-cookie decline without re-prompting', async () => {
    const service = makeService();
    mockPrisma.consent.findFirst.mockImplementation(({ where }: any) => {
      if (where.purpose === 'marketing_cookies') {
        return Promise.resolve({
          purpose: 'marketing_cookies',
          version: '2026-07-01',
          granted: false,
        });
      }
      return Promise.resolve({ purpose: where.purpose, version: '2026-07-01', granted: true });
    });

    await expect(service.getStaleConsents('user-1')).resolves.toEqual([]);
  });

  it('still treats declined required terms or privacy consent as stale', async () => {
    const service = makeService();
    mockPrisma.consent.findFirst.mockImplementation(({ where }: any) =>
      Promise.resolve({
        purpose: where.purpose,
        version: '2026-07-01',
        granted: where.purpose !== 'terms_of_service',
      }),
    );

    await expect(service.getStaleConsents('user-1')).resolves.toEqual(['terms_of_service']);
  });

  it('rejects an outdated authenticated policy acknowledgement', async () => {
    const service = makeService();
    await expect(
      service.recordConsent('user-1', 'developer', 'privacy_policy', '2025-01-01', true),
    ).rejects.toThrow('not current');
    expect(mockPrisma.consent.create).not.toHaveBeenCalled();
  });

  it('rejects arbitrary authenticated consent purposes that could grow storage', async () => {
    const service = makeService();
    await expect(
      service.recordConsent('user-1', 'developer', 'attacker_defined_purpose', '2026-07-01'),
    ).rejects.toThrow(/Unsupported consent purpose/);
    expect(mockPrisma.consent.create).not.toHaveBeenCalled();
  });

  it('does not append duplicate authenticated consent state', async () => {
    const service = makeService();
    const existing = {
      id: 'consent-existing',
      userId: 'user-1',
      purpose: 'privacy_policy',
      version: '2026-07-01',
      granted: true,
    };
    mockPrisma.consent.findFirst.mockResolvedValue(existing);

    await expect(
      service.recordConsent('user-1', 'developer', 'privacy_policy', '2026-07-01', true),
    ).resolves.toBe(existing);
    expect(mockPrisma.consent.create).not.toHaveBeenCalled();
    expect(audit.logStrict).not.toHaveBeenCalled();
  });
});
