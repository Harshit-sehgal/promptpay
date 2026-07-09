import { createHash } from 'crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BadRequestException } from '@nestjs/common';

import { ComplianceService } from './compliance.service';

const mockPrisma = {
  consent: {
    create: vi.fn(),
    findFirst: vi.fn(),
    update: vi.fn(),
  },
} as any;

const audit = {
  log: vi.fn().mockResolvedValue(undefined),
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
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'consent_granted', actorId: 'anonymous' }),
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
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'consent_revoked', actorId: 'anonymous' }),
    );
  });

  it('rejects an invalid (unsupported) consent purpose', async () => {
    const service = makeService();
    await expect(
      service.recordAnonymousConsent({ visitorId: VISITOR, purpose: 'not_a_real_purpose' }),
    ).rejects.toThrow(BadRequestException);
    expect(mockPrisma.consent.create).not.toHaveBeenCalled();
  });

  it('updates rather than duplicates an existing anonymous consent for the same visitor + purpose', async () => {
    const service = makeService();
    mockPrisma.consent.findFirst.mockResolvedValue({
      id: 'c-existing',
      userId: null,
      visitorIdHash: VISITOR_HASH,
      purpose: 'marketing_cookies',
      version: '2026-07-01',
      granted: false,
    });
    mockPrisma.consent.update.mockResolvedValue({
      id: 'c-existing',
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

    expect(mockPrisma.consent.create).not.toHaveBeenCalled();
    expect(mockPrisma.consent.update).toHaveBeenCalledTimes(1);
    expect(mockPrisma.consent.update.mock.calls[0][0].where).toEqual({ id: 'c-existing' });
    expect(mockPrisma.consent.update.mock.calls[0][0].data.granted).toBe(true);
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
