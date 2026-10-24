import { vi } from 'vitest';
import { BadRequestException, NotFoundException } from '@nestjs/common';

import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../config/prisma.service';
import { PeopleService } from './people.service';

const FORBIDDEN = [
  'passwordHash',
  'twoFactorSecret',
  'twoFactorBackupCodeHashes',
  'ipHash',
  'visitorIdHash',
  'fingerprintHash',
  'eventSecret',
  'publicKey',
  'googleId',
  'githubId',
];

function makeService() {
  const user = {
    count: vi.fn().mockResolvedValue(0),
    groupBy: vi.fn().mockResolvedValue([]),
    findMany: vi.fn().mockResolvedValue([]),
    findUnique: vi.fn(),
  };
  const advertiserWaitlist = {
    count: vi.fn().mockResolvedValue(0),
    groupBy: vi.fn().mockResolvedValue([]),
    findMany: vi.fn().mockResolvedValue([]),
    findUnique: vi.fn(),
    findUniqueOrThrow: vi.fn(),
    updateMany: vi.fn().mockResolvedValue({ count: 1 }),
  };
  const device = { groupBy: vi.fn().mockResolvedValue([]) };
  const fraudFlag = { count: vi.fn().mockResolvedValue(0) };
  const auditLog = vi.fn().mockResolvedValue(undefined);
  const auditStrict = vi.fn().mockResolvedValue(undefined);
  const prisma = { user, advertiserWaitlist, device, fraudFlag } as unknown as PrismaService;
  const audit = { log: auditLog, logStrict: auditStrict } as unknown as AuditService;
  return {
    service: new PeopleService(prisma, audit),
    user,
    advertiserWaitlist,
    device,
    fraudFlag,
    auditStrict,
    auditLog,
  };
}

const WL_RECORD = {
  id: 'wl-1',
  email: 'Lead@Example.com',
  company: 'Acme',
  country: 'US',
  status: 'pending',
  consent: true,
  source: 'advertisers_page',
  createdAt: new Date('2026-10-01T00:00:00Z'),
  updatedAt: new Date('2026-10-02T00:00:00Z'),
};

function userRecord(id: string) {
  return {
    id,
    email: `${id}@example.com`,
    name: null,
    role: 'developer',
    status: 'active',
    trustLevel: 'new',
    country: 'IN',
    emailVerified: true,
    googleVerified: false,
    githubVerified: false,
    twoFactorEnabled: false,
    createdAt: new Date('2026-10-01T00:00:00Z'),
    advertiser: null,
    _count: { devices: 1 },
  };
}

describe('PeopleService', () => {
  afterEach(() => vi.useRealTimers());

  describe('pagination', () => {
    it('caps limit at 100 and defaults to 25', async () => {
      const { service, user } = makeService();
      const big = await service.listUsers({}, { page: 3, limit: 5000 });
      expect(big.limit).toBe(100);
      expect(big.page).toBe(3);
      expect(user.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 100, skip: 200 }));

      const dflt = await service.listUsers({}, {});
      expect(dflt).toMatchObject({ page: 1, limit: 25 });
    });

    it('applies the same cap to the waitlist', async () => {
      const { service, advertiserWaitlist } = makeService();
      await service.listWaitlist({}, { limit: 101 });
      expect(advertiserWaitlist.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 100, skip: 0 }),
      );
    });
  });

  describe('validation', () => {
    it('rejects invalid role, status, verified and dates with 400', async () => {
      const { service } = makeService();
      await expect(service.listUsers({ role: 'root' }, {})).rejects.toBeInstanceOf(
        BadRequestException,
      );
      await expect(service.listUsers({ status: 'nope' }, {})).rejects.toBeInstanceOf(
        BadRequestException,
      );
      await expect(service.listUsers({ verified: 'maybe' }, {})).rejects.toBeInstanceOf(
        BadRequestException,
      );
      await expect(service.listUsers({ from: 'not-a-date' }, {})).rejects.toBeInstanceOf(
        BadRequestException,
      );
      await expect(service.listWaitlist({ status: 'vip' }, {})).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('rejects an invalid export kind', async () => {
      const { service, auditLog } = makeService();
      await expect(service.exportPeople('a', 'admin', 'everything', {})).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(auditLog).not.toHaveBeenCalled();
    });

    it('builds filters: case-insensitive search/country, inclusive day bounds', async () => {
      const { service, user } = makeService();
      await service.listUsers(
        {
          search: ' Ann ',
          role: 'advertiser',
          verified: 'unverified',
          country: 'in',
          from: '2026-10-01',
          to: '2026-10-03',
        },
        {},
      );
      const where = user.findMany.mock.calls[0][0].where;
      expect(where.role).toBe('advertiser');
      expect(where.emailVerified).toBe(false);
      expect(where.country).toEqual({ equals: 'in', mode: 'insensitive' });
      expect(where.OR).toEqual([
        { email: { contains: 'Ann', mode: 'insensitive' } },
        { name: { contains: 'Ann', mode: 'insensitive' } },
      ]);
      expect(where.createdAt.gte.toISOString()).toBe('2026-10-01T00:00:00.000Z');
      expect(where.createdAt.lt.toISOString()).toBe('2026-10-04T00:00:00.000Z');
    });
  });

  describe('rows', () => {
    it('attaches lastSeenAt from one grouped device query', async () => {
      const { service, user, device } = makeService();
      user.findMany.mockResolvedValue([userRecord('u1'), userRecord('u2')]);
      device.groupBy.mockResolvedValue([
        { userId: 'u1', _max: { lastSeenAt: new Date('2026-10-20T10:00:00Z') } },
      ]);
      const res = await service.listUsers({}, {});
      expect(device.groupBy).toHaveBeenCalledTimes(1);
      expect(res.rows[0].lastSeenAt).toBe('2026-10-20T10:00:00.000Z');
      expect(res.rows[1].lastSeenAt).toBeNull();
      expect(res.rows[0].deviceCount).toBe(1);
      expect(typeof res.rows[0].createdAt).toBe('string');
    });

    it('sets registeredUserId case-insensitively with a single user query', async () => {
      const { service, advertiserWaitlist, user } = makeService();
      advertiserWaitlist.findMany.mockResolvedValue([
        WL_RECORD,
        { ...WL_RECORD, id: 'wl-2', email: 'other@example.com' },
      ]);
      user.findMany.mockResolvedValue([{ id: 'u-9', email: 'lead@example.com' }]);
      const res = await service.listWaitlist({}, {});
      expect(user.findMany).toHaveBeenCalledTimes(1);
      expect(res.rows[0].registeredUserId).toBe('u-9');
      expect(res.rows[1].registeredUserId).toBeNull();
    });
  });

  describe('getUser', () => {
    it('throws 404 for an unknown id', async () => {
      const { service, user } = makeService();
      user.findUnique.mockResolvedValue(null);
      await expect(service.getUser('x')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('maps referral, advertiser, devices and open flags', async () => {
      const { service, user, fraudFlag } = makeService();
      user.findUnique.mockResolvedValue({
        ...userRecord('u1'),
        referralCode: 'WAIT-7Q2K',
        updatedAt: new Date('2026-10-05T00:00:00Z'),
        advertiser: {
          companyName: 'Acme',
          billingEmail: 'b@acme.com',
          websiteUrl: null,
          trustStatus: 'new',
        },
        consents: [],
        devices: [
          {
            id: 'd1',
            toolType: 'claude_code',
            platform: null,
            extensionVersion: null,
            createdAt: new Date('2026-10-01T00:00:00Z'),
            lastSeenAt: new Date('2026-10-04T00:00:00Z'),
          },
        ],
        referralIn: [{ referrer: { id: 'r1', email: 'r@example.com' } }],
        _count: { devices: 1, referralOut: 3 },
      });
      fraudFlag.count.mockResolvedValue(2);
      const d = await service.getUser('u1');
      expect(d.referredBy).toEqual({ id: 'r1', email: 'r@example.com' });
      expect(d.referralsMade).toBe(3);
      expect(d.openFlags).toBe(2);
      expect(d.companyName).toBe('Acme');
      expect(d.lastSeenAt).toBe('2026-10-04T00:00:00.000Z');
      expect(d.advertiser?.billingEmail).toBe('b@acme.com');
    });
  });

  describe('setWaitlistStatus', () => {
    it('audits the change with before/after and no email', async () => {
      const { service, advertiserWaitlist, auditLog } = makeService();
      advertiserWaitlist.findUnique.mockResolvedValue(WL_RECORD);
      advertiserWaitlist.findUniqueOrThrow.mockResolvedValue({ ...WL_RECORD, status: 'invited' });
      const row = await service.setWaitlistStatus('admin-1', 'admin', 'wl-1', 'invited');
      expect(row.status).toBe('invited');
      expect(advertiserWaitlist.updateMany).toHaveBeenCalledWith({
        where: { id: 'wl-1', status: 'pending' },
        data: { status: 'invited' },
      });
      expect(auditLog).toHaveBeenCalledTimes(1);
      const entry = auditLog.mock.calls[0][0];
      expect(entry).toMatchObject({
        actorId: 'admin-1',
        actorRole: 'admin',
        action: 'admin_set_waitlist_status',
        targetType: 'advertiser_waitlist',
        targetId: 'wl-1',
        beforeSnap: { status: 'pending' },
        afterSnap: { status: 'invited' },
      });
      expect(JSON.stringify(entry).toLowerCase()).not.toContain('example.com');
    });

    it('is a no-op (no write, no audit) when the status is unchanged', async () => {
      const { service, advertiserWaitlist, auditLog } = makeService();
      advertiserWaitlist.findUnique.mockResolvedValue(WL_RECORD);
      const row = await service.setWaitlistStatus('admin-1', 'admin', 'wl-1', 'pending');
      expect(row.id).toBe('wl-1');
      expect(advertiserWaitlist.updateMany).not.toHaveBeenCalled();
      expect(auditLog).not.toHaveBeenCalled();
    });

    it('does not audit when another admin changed the row first', async () => {
      const { service, advertiserWaitlist, auditLog } = makeService();
      advertiserWaitlist.findUnique.mockResolvedValue(WL_RECORD);
      advertiserWaitlist.updateMany.mockResolvedValue({ count: 0 });
      advertiserWaitlist.findUniqueOrThrow.mockResolvedValue({ ...WL_RECORD, status: 'declined' });
      const row = await service.setWaitlistStatus('admin-1', 'admin', 'wl-1', 'invited');
      expect(row.status).toBe('declined');
      expect(auditLog).not.toHaveBeenCalled();
    });

    it('400 on invalid status (before any lookup), 404 on unknown id', async () => {
      const { service, advertiserWaitlist } = makeService();
      await expect(service.setWaitlistStatus('a', 'admin', 'wl-1', 'vip')).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(advertiserWaitlist.findUnique).not.toHaveBeenCalled();

      advertiserWaitlist.findUnique.mockResolvedValue(null);
      await expect(
        service.setWaitlistStatus('a', 'admin', 'nope', 'invited'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('summary', () => {
    it('zero-fills 30 UTC days oldest first and buckets signups', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-10-25T15:30:00Z'));
      const { service, user, advertiserWaitlist } = makeService();
      user.groupBy
        .mockResolvedValueOnce([
          { role: 'developer', _count: { _all: 4 } },
          { role: 'advertiser', _count: { _all: 0 } },
        ])
        .mockResolvedValueOnce([{ status: 'active', _count: { _all: 4 } }]);
      advertiserWaitlist.groupBy.mockResolvedValue([{ status: 'invited', _count: { _all: 2 } }]);
      user.findMany.mockResolvedValue([
        { createdAt: new Date('2026-10-25T01:00:00Z') },
        { createdAt: new Date('2026-10-25T23:59:00Z') },
        { createdAt: new Date('2026-09-26T00:00:00Z') },
      ]);
      advertiserWaitlist.findMany.mockResolvedValue([
        { createdAt: new Date('2026-10-24T12:00:00Z') },
      ]);

      const s = await service.summary();
      expect(s.signupsByDay).toHaveLength(30);
      expect(s.signupsByDay[0]).toEqual({ date: '2026-09-26', users: 1, waitlist: 0 });
      expect(s.signupsByDay[29]).toEqual({ date: '2026-10-25', users: 2, waitlist: 0 });
      expect(s.signupsByDay[28]).toEqual({ date: '2026-10-24', users: 0, waitlist: 1 });
      expect(s.signupsByDay[10]).toEqual({ date: '2026-10-06', users: 0, waitlist: 0 });

      // series windows start at 00:00 UTC of the oldest day
      const gte = user.findMany.mock.calls[0][0].where.createdAt.gte as Date;
      expect(gte.toISOString()).toBe('2026-09-26T00:00:00.000Z');
      expect(user.findMany.mock.calls[0][0].select).toEqual({ createdAt: true });

      expect(s.users.byRole).toEqual({ developer: 4 });
      expect(s.users.byStatus).toEqual({ active: 4 });
      expect(s.waitlist.byStatus).toEqual({ pending: 0, invited: 2, onboarded: 0, declined: 0 });
    });
  });

  describe('exportPeople', () => {
    it('caps at 10000, flags truncation, and audits strictly without PII', async () => {
      const { service, advertiserWaitlist, auditStrict: auditLog } = makeService();
      const many = Array.from({ length: 10_001 }, (_, i) => ({ ...WL_RECORD, id: `wl-${i}` }));
      advertiserWaitlist.findMany.mockResolvedValueOnce(many);
      const res = await service.exportPeople('admin-1', 'admin', 'waitlist', {
        search: 'someone@example.com',
      });
      expect(advertiserWaitlist.findMany.mock.calls[0][0].take).toBe(10_001);
      expect(res.rows).toHaveLength(10_000);
      expect(res.truncated).toBe(true);
      expect(auditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'admin_exported_people',
          afterSnap: expect.objectContaining({
            kind: 'waitlist',
            rows: 10_000,
            truncated: true,
            filters: expect.objectContaining({ search: true }),
          }),
        }),
      );
      expect(JSON.stringify(auditLog.mock.calls[0][0])).not.toContain('example.com');
    });

    it('exports users with the list row shape and not truncated', async () => {
      const { service, user, auditStrict: auditLog } = makeService();
      user.findMany.mockResolvedValueOnce([userRecord('u1')]);
      const res = await service.exportPeople('admin-1', 'admin', 'users', { role: 'developer' });
      expect(res.truncated).toBe(false);
      expect(res.rows).toHaveLength(1);
      expect(auditLog.mock.calls[0][0].afterSnap).toMatchObject({
        kind: 'users',
        rows: 1,
        truncated: false,
        filters: { role: 'developer', search: false },
      });
    });
  });

  describe('selects never include secrets or pseudonyms', () => {
    it('across every query the service issues', async () => {
      const { service, user, advertiserWaitlist, device } = makeService();
      user.findMany.mockResolvedValue([userRecord('u1')]);
      advertiserWaitlist.findMany.mockResolvedValue([WL_RECORD]);
      advertiserWaitlist.findUnique.mockResolvedValue(WL_RECORD);
      advertiserWaitlist.findUniqueOrThrow.mockResolvedValue({ ...WL_RECORD, status: 'invited' });
      user.findUnique.mockResolvedValue({
        ...userRecord('u1'),
        referralCode: null,
        updatedAt: new Date(),
        consents: [],
        devices: [],
        referralIn: [],
        _count: { devices: 0, referralOut: 0 },
      });

      await service.summary();
      await service.listUsers({}, {});
      await service.getUser('u1');
      await service.listWaitlist({}, {});
      await service.setWaitlistStatus('a', 'admin', 'wl-1', 'invited');
      await service.exportPeople('a', 'admin', 'users', {});
      await service.exportPeople('a', 'admin', 'waitlist', {});

      const calls = [
        ...user.findMany.mock.calls,
        ...user.findUnique.mock.calls,
        ...advertiserWaitlist.findMany.mock.calls,
        ...advertiserWaitlist.findUnique.mock.calls,
        ...advertiserWaitlist.findUniqueOrThrow.mock.calls,
        ...device.groupBy.mock.calls,
      ];
      expect(calls.length).toBeGreaterThan(0);
      for (const [args] of calls) {
        // every call selects explicitly (or is a groupBy, which only returns by/_max)
        expect(args.select ?? args.by).toBeDefined();
        const serialised = JSON.stringify(args.select ?? {});
        for (const field of FORBIDDEN) expect(serialised).not.toContain(field);
      }
    });
  });
});
