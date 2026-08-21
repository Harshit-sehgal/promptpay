import { vi } from 'vitest';
import { BadRequestException } from '@nestjs/common';

import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../config/prisma.service';
import { CreateWaitlistDto } from './dto/waitlist.dto';
import { WaitlistService } from './waitlist.service';

function makeService() {
  const create = vi.fn();
  const findUnique = vi.fn();
  const findMany = vi.fn();
  const count = vi.fn();
  const auditLog = vi.fn().mockResolvedValue(undefined);
  const prisma = {
    advertiserWaitlist: { create, findUnique, findMany, count },
  } as unknown as PrismaService;
  const audit = { log: auditLog, logStrict: auditLog } as unknown as AuditService;
  const service = new WaitlistService(prisma, audit);
  return { service, create, findUnique, findMany, count, auditLog };
}

const BASE: CreateWaitlistDto = {
  email: 'Marketing@Example.com',
  consent: true,
};

describe('WaitlistService', () => {
  it('normalizes email to lowercase and persists consent + pseudonym', async () => {
    const { service, create, auditLog } = makeService();
    create.mockResolvedValue({ id: 'wl-1' });

    const res = await service.submit(
      { ...BASE, company: '  Acme Corp  ', country: 'us' },
      {
        ip: '1.2.3.4',
      },
    );

    expect(res).toEqual({ received: true });
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          email: 'marketing@example.com',
          company: 'Acme Corp',
          country: 'US',
          consent: true,
        }),
      }),
    );
    // Audit trail records the row id — never the email (PII stays in one table).
    expect(auditLog).toHaveBeenCalledTimes(1);
    const entry = auditLog.mock.calls[0][0];
    expect(entry.targetType).toBe('advertiser_waitlist');
    expect(entry.targetId).toBe('wl-1');
    expect(JSON.stringify(entry.afterSnap)).not.toContain('marketing@example.com');
    expect(entry.afterSnap.hasEmail).toBe(true);
    expect(entry.afterSnap.country).toBe('US');
  });

  it('rejects submissions without consent', async () => {
    const { service, create } = makeService();
    await expect(service.submit({ email: 'a@b.com', consent: false }, {})).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(create).not.toHaveBeenCalled();
  });

  it('rejects honeypot submissions as spam', async () => {
    const { service, create } = makeService();
    await expect(
      service.submit({ ...BASE, website: 'https://spam.example' }, {}),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(create).not.toHaveBeenCalled();
  });

  it('is idempotent: a duplicate email returns the existing row unchanged', async () => {
    const { service, findUnique, create } = makeService();
    findUnique.mockResolvedValue({ id: 'wl-1', status: 'invited', consent: true });

    const res = await service.submit(BASE, {});

    expect(res).toEqual({ received: true, alreadySignedUp: true });
    expect(create).not.toHaveBeenCalled();
  });

  it('treats a concurrent duplicate-create race as a duplicate, not an error', async () => {
    const { service, findUnique, create } = makeService();
    findUnique.mockResolvedValue(null);
    const p2002 = new Error('unique violation');
    Object.assign(p2002, { code: 'P2002' });
    create.mockRejectedValue(p2002);

    const res = await service.submit(BASE, {});
    expect(res).toEqual({ received: true, alreadySignedUp: true });
  });

  it('re-raises non-duplicate create errors', async () => {
    const { service, findUnique, create } = makeService();
    findUnique.mockResolvedValue(null);
    create.mockRejectedValue(new Error('db down'));

    await expect(service.submit(BASE, {})).rejects.toThrow('db down');
  });

  it('lists for admin with bounded pagination and no ipHash', async () => {
    const { service, findMany, count } = makeService();
    findMany.mockResolvedValue([{ id: 'wl-1', email: 'a@b.com' }]);
    count.mockResolvedValue(1);

    const res = await service.listForAdmin({ status: 'pending', page: 2, limit: 50 });

    expect(res).toEqual({ rows: [{ id: 'wl-1', email: 'a@b.com' }], total: 1, page: 2, limit: 50 });
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { status: 'pending' },
        select: expect.not.objectContaining({ ipHash: expect.anything() }),
        skip: 50,
        take: 50,
      }),
    );
  });

  it('caps the admin listing at 100 rows per page', async () => {
    const { service, findMany, count } = makeService();
    findMany.mockResolvedValue([]);
    count.mockResolvedValue(0);

    await service.listForAdmin({ limit: 500 });
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 100 }));
  });
});
