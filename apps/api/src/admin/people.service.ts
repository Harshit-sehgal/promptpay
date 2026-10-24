import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';

import { Prisma, UserRole, UserStatus } from '@ateva/db';

import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../config/prisma.service';
import { WAITLIST_STATUSES } from './dto/people.dto';

/**
 * Admin "People CRM": a read-mostly view over registered users and the
 * advertiser waitlist, plus waitlist status transitions.
 *
 * Every query uses an explicit `select`. Secrets and pseudonyms (passwordHash,
 * twoFactorSecret, backup codes, ipHash, visitorIdHash, device
 * fingerprintHash/eventSecret/publicKey, googleId, githubId) are never
 * selected, so they cannot leak by accident when a column is added later.
 */

const MAX_LIMIT = 100;
const DEFAULT_LIMIT = 25;
const EXPORT_CAP = 10_000;
const DETAIL_CHILD_CAP = 50;
const SEARCH_MAX = 200;
const DAY_MS = 86_400_000;

const USER_ROLES = Object.values(UserRole) as string[];
const USER_STATUSES = Object.values(UserStatus) as string[];
type AdvertiserWaitlistStatus = NonNullable<Prisma.AdvertiserWaitlistCreateInput['status']>;

export interface PageOpts {
  page?: number;
  limit?: number;
}

export interface UsersFilter {
  search?: string;
  role?: string;
  status?: string;
  country?: string;
  verified?: string;
  from?: string;
  to?: string;
}

export interface WaitlistFilter {
  search?: string;
  status?: string;
  country?: string;
}

const USER_ROW_SELECT = {
  id: true,
  email: true,
  name: true,
  role: true,
  status: true,
  trustLevel: true,
  country: true,
  emailVerified: true,
  googleVerified: true,
  githubVerified: true,
  twoFactorEnabled: true,
  createdAt: true,
  advertiser: { select: { companyName: true } },
  _count: { select: { devices: true } },
} satisfies Prisma.UserSelect;

const WAITLIST_ROW_SELECT = {
  id: true,
  email: true,
  company: true,
  country: true,
  status: true,
  consent: true,
  source: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.AdvertiserWaitlistSelect;

type UserRowRecord = Prisma.UserGetPayload<{ select: typeof USER_ROW_SELECT }>;
type WaitlistRowRecord = Prisma.AdvertiserWaitlistGetPayload<{
  select: typeof WAITLIST_ROW_SELECT;
}>;

@Injectable()
export class PeopleService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // ── Summary ────────────────────────────────────────────────────────────

  async summary() {
    const now = new Date();
    const d7 = new Date(now.getTime() - 7 * DAY_MS);
    const d30 = new Date(now.getTime() - 30 * DAY_MS);
    const seriesStart = startOfUtcDay(new Date(now.getTime() - 29 * DAY_MS));

    const [
      userTotal,
      byRole,
      byStatus,
      emailVerified,
      twoFactorEnabled,
      userLast7d,
      userLast30d,
      waitTotal,
      waitByStatus,
      waitLast7d,
      waitLast30d,
      userDates,
      waitDates,
    ] = await Promise.all([
      this.prisma.user.count(),
      this.prisma.user.groupBy({ by: ['role'], _count: { _all: true } }),
      this.prisma.user.groupBy({ by: ['status'], _count: { _all: true } }),
      this.prisma.user.count({ where: { emailVerified: true } }),
      this.prisma.user.count({ where: { twoFactorEnabled: true } }),
      this.prisma.user.count({ where: { createdAt: { gte: d7 } } }),
      this.prisma.user.count({ where: { createdAt: { gte: d30 } } }),
      this.prisma.advertiserWaitlist.count(),
      this.prisma.advertiserWaitlist.groupBy({ by: ['status'], _count: { _all: true } }),
      this.prisma.advertiserWaitlist.count({ where: { createdAt: { gte: d7 } } }),
      this.prisma.advertiserWaitlist.count({ where: { createdAt: { gte: d30 } } }),
      this.prisma.user.findMany({
        where: { createdAt: { gte: seriesStart } },
        select: { createdAt: true },
      }),
      this.prisma.advertiserWaitlist.findMany({
        where: { createdAt: { gte: seriesStart } },
        select: { createdAt: true },
      }),
    ]);

    const waitlistByStatus: Record<string, number> = {};
    for (const s of WAITLIST_STATUSES) waitlistByStatus[s] = 0;
    for (const g of waitByStatus) waitlistByStatus[g.status] = g._count._all;

    return {
      users: {
        total: userTotal,
        byRole: countMap(byRole.map((g) => [g.role, g._count._all])),
        byStatus: countMap(byStatus.map((g) => [g.status, g._count._all])),
        emailVerified,
        twoFactorEnabled,
        last7d: userLast7d,
        last30d: userLast30d,
      },
      waitlist: {
        total: waitTotal,
        byStatus: waitlistByStatus,
        last7d: waitLast7d,
        last30d: waitLast30d,
      },
      signupsByDay: buildSignupSeries(
        seriesStart,
        userDates.map((r) => r.createdAt),
        waitDates.map((r) => r.createdAt),
      ),
    };
  }

  // ── Registered users ───────────────────────────────────────────────────

  async listUsers(filter: UsersFilter, opts: PageOpts) {
    const where = this.buildUsersWhere(filter);
    const { take, skip, page } = paginate(opts);
    const [records, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        select: USER_ROW_SELECT,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take,
        skip,
      }),
      this.prisma.user.count({ where }),
    ]);
    return { rows: await this.toUserRows(records), total, page, limit: take };
  }

  async getUser(id: string) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: {
        ...USER_ROW_SELECT,
        referralCode: true,
        updatedAt: true,
        advertiser: {
          select: {
            companyName: true,
            billingEmail: true,
            websiteUrl: true,
            trustStatus: true,
          },
        },
        consents: {
          select: { purpose: true, version: true, granted: true, createdAt: true },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          take: DETAIL_CHILD_CAP,
        },
        devices: {
          select: {
            id: true,
            toolType: true,
            platform: true,
            extensionVersion: true,
            createdAt: true,
            lastSeenAt: true,
          },
          orderBy: { lastSeenAt: 'desc' },
          take: DETAIL_CHILD_CAP,
        },
        referralIn: {
          select: { referrer: { select: { id: true, email: true } } },
          take: 1,
        },
        _count: { select: { devices: true, referralOut: true } },
      },
    });
    if (!user) throw new NotFoundException('User not found');

    const openFlags = await this.prisma.fraudFlag.count({
      where: { userId: id, status: 'open' },
    });

    const referrer = user.referralIn[0]?.referrer ?? null;
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      status: user.status,
      trustLevel: user.trustLevel,
      country: user.country,
      emailVerified: user.emailVerified,
      googleVerified: user.googleVerified,
      githubVerified: user.githubVerified,
      twoFactorEnabled: user.twoFactorEnabled,
      createdAt: iso(user.createdAt),
      companyName: user.advertiser?.companyName ?? null,
      deviceCount: user._count.devices,
      lastSeenAt: user.devices[0] ? iso(user.devices[0].lastSeenAt) : null,
      referralCode: user.referralCode,
      updatedAt: iso(user.updatedAt),
      advertiser: user.advertiser
        ? {
            companyName: user.advertiser.companyName,
            billingEmail: user.advertiser.billingEmail,
            websiteUrl: user.advertiser.websiteUrl,
            trustStatus: user.advertiser.trustStatus,
          }
        : null,
      consents: user.consents.map((c) => ({
        purpose: c.purpose,
        version: c.version,
        granted: c.granted,
        createdAt: iso(c.createdAt),
      })),
      devices: user.devices.map((d) => ({
        id: d.id,
        toolType: d.toolType,
        platform: d.platform,
        extensionVersion: d.extensionVersion,
        createdAt: iso(d.createdAt),
        lastSeenAt: iso(d.lastSeenAt),
      })),
      referredBy: referrer ? { id: referrer.id, email: referrer.email } : null,
      referralsMade: user._count.referralOut,
      openFlags,
    };
  }

  // ── Waitlist ───────────────────────────────────────────────────────────

  async listWaitlist(filter: WaitlistFilter, opts: PageOpts) {
    const where = this.buildWaitlistWhere(filter);
    const { take, skip, page } = paginate(opts);
    const [records, total] = await Promise.all([
      this.prisma.advertiserWaitlist.findMany({
        where,
        select: WAITLIST_ROW_SELECT,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take,
        skip,
      }),
      this.prisma.advertiserWaitlist.count({ where }),
    ]);
    return { rows: await this.toWaitlistRows(records), total, page, limit: take };
  }

  async setWaitlistStatus(actorId: string, actorRole: string, id: string, status: string) {
    if (!(WAITLIST_STATUSES as readonly string[]).includes(status)) {
      throw new BadRequestException(`Invalid waitlist status: ${String(status)}`);
    }
    const target = await this.prisma.advertiserWaitlist.findUnique({
      where: { id },
      select: WAITLIST_ROW_SELECT,
    });
    if (!target) throw new NotFoundException('Waitlist entry not found');

    if (target.status === status) {
      return (await this.toWaitlistRows([target]))[0];
    }

    // Conditional write: if another admin changed the row since the read,
    // the count is 0 and nothing is audited against a stale before-snapshot.
    const { count } = await this.prisma.advertiserWaitlist.updateMany({
      where: { id, status: target.status },
      data: { status: status as AdvertiserWaitlistStatus },
    });
    const updated = await this.prisma.advertiserWaitlist.findUniqueOrThrow({
      where: { id },
      select: WAITLIST_ROW_SELECT,
    });
    if (count === 0) return (await this.toWaitlistRows([updated]))[0];
    await this.audit.log({
      actorId,
      actorRole,
      action: 'admin_set_waitlist_status',
      targetType: 'advertiser_waitlist',
      targetId: id,
      // No email: PII stays in the waitlist row (see WaitlistService).
      beforeSnap: { status: target.status },
      afterSnap: { status },
    });
    return (await this.toWaitlistRows([updated]))[0];
  }

  // ── Export ─────────────────────────────────────────────────────────────

  async exportPeople(
    actorId: string,
    actorRole: string,
    kind: string,
    filter: UsersFilter & WaitlistFilter,
  ) {
    if (kind !== 'users' && kind !== 'waitlist') {
      throw new BadRequestException('kind must be "users" or "waitlist"');
    }

    let rows: unknown[];
    let truncated: boolean;
    if (kind === 'users') {
      const records = await this.prisma.user.findMany({
        where: this.buildUsersWhere(filter),
        select: USER_ROW_SELECT,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: EXPORT_CAP + 1,
      });
      truncated = records.length > EXPORT_CAP;
      rows = await this.toUserRows(records.slice(0, EXPORT_CAP));
    } else {
      const records = await this.prisma.advertiserWaitlist.findMany({
        where: this.buildWaitlistWhere(filter),
        select: WAITLIST_ROW_SELECT,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: EXPORT_CAP + 1,
      });
      truncated = records.length > EXPORT_CAP;
      rows = await this.toWaitlistRows(records.slice(0, EXPORT_CAP));
    }

    // Bulk PII leaves the system here, so the evidence must land before the
    // data does. Filters are recorded without the free-text search term.
    await this.audit.logStrict({
      actorId,
      actorRole,
      action: 'admin_exported_people',
      targetType: 'people_export',
      targetId: kind,
      afterSnap: {
        kind,
        rows: rows.length,
        truncated,
        filters: {
          role: filter.role ?? null,
          status: filter.status ?? null,
          country: filter.country ?? null,
          verified: filter.verified ?? null,
          from: filter.from ?? null,
          to: filter.to ?? null,
          search: Boolean(filter.search?.trim()),
        },
      },
    });
    return { rows, truncated };
  }

  // ── Internals ──────────────────────────────────────────────────────────

  private buildUsersWhere(f: UsersFilter): Prisma.UserWhereInput {
    const where: Prisma.UserWhereInput = {};
    if (f.role) {
      if (!USER_ROLES.includes(f.role)) throw new BadRequestException(`Invalid role: ${f.role}`);
      where.role = f.role as UserRole;
    }
    if (f.status) {
      if (!USER_STATUSES.includes(f.status)) {
        throw new BadRequestException(`Invalid status: ${f.status}`);
      }
      where.status = f.status as UserStatus;
    }
    if (f.verified) {
      if (f.verified !== 'email' && f.verified !== 'unverified') {
        throw new BadRequestException('verified must be "email" or "unverified"');
      }
      where.emailVerified = f.verified === 'email';
    }
    const country = f.country?.trim();
    if (country) where.country = { equals: country, mode: 'insensitive' };
    const search = cleanSearch(f.search);
    if (search) {
      where.OR = [
        { email: { contains: search, mode: 'insensitive' } },
        { name: { contains: search, mode: 'insensitive' } },
      ];
    }
    const createdAt = dateRange(f.from, f.to);
    if (createdAt) where.createdAt = createdAt;
    return where;
  }

  private buildWaitlistWhere(f: WaitlistFilter): Prisma.AdvertiserWaitlistWhereInput {
    const where: Prisma.AdvertiserWaitlistWhereInput = {};
    if (f.status) {
      if (!(WAITLIST_STATUSES as readonly string[]).includes(f.status)) {
        throw new BadRequestException(`Invalid status: ${f.status}`);
      }
      where.status = f.status as AdvertiserWaitlistStatus;
    }
    const country = f.country?.trim();
    if (country) where.country = { equals: country, mode: 'insensitive' };
    const search = cleanSearch(f.search);
    if (search) {
      where.OR = [
        { email: { contains: search, mode: 'insensitive' } },
        { company: { contains: search, mode: 'insensitive' } },
      ];
    }
    return where;
  }

  /** Attach lastSeenAt (one grouped query for the whole page). */
  private async toUserRows(records: UserRowRecord[]) {
    const seen = new Map<string, Date>();
    if (records.length > 0) {
      const groups = await this.prisma.device.groupBy({
        by: ['userId'],
        where: { userId: { in: records.map((r) => r.id) } },
        _max: { lastSeenAt: true },
      });
      for (const g of groups) {
        if (g._max.lastSeenAt) seen.set(g.userId, g._max.lastSeenAt);
      }
    }
    return records.map((u) => ({
      id: u.id,
      email: u.email,
      name: u.name,
      role: u.role,
      status: u.status,
      trustLevel: u.trustLevel,
      country: u.country,
      emailVerified: u.emailVerified,
      googleVerified: u.googleVerified,
      githubVerified: u.githubVerified,
      twoFactorEnabled: u.twoFactorEnabled,
      createdAt: iso(u.createdAt),
      companyName: u.advertiser?.companyName ?? null,
      deviceCount: u._count.devices,
      lastSeenAt: seen.has(u.id) ? iso(seen.get(u.id) as Date) : null,
    }));
  }

  /** Attach registeredUserId with a single email lookup for the whole page. */
  private async toWaitlistRows(records: WaitlistRowRecord[]) {
    const byEmail = new Map<string, string>();
    if (records.length > 0) {
      const emails = [...new Set(records.map((r) => r.email.toLowerCase()))];
      const users = await this.prisma.user.findMany({
        // Emails are stored lowercased on both sides (auth canonicalises,
        // the waitlist lowercases), so `in` can use the unique email index.
        where: { email: { in: emails } },
        select: { id: true, email: true },
      });
      for (const u of users) byEmail.set(u.email.toLowerCase(), u.id);
    }
    return records.map((r) => ({
      id: r.id,
      email: r.email,
      company: r.company,
      country: r.country,
      status: r.status,
      consent: r.consent,
      source: r.source,
      createdAt: iso(r.createdAt),
      updatedAt: iso(r.updatedAt),
      registeredUserId: byEmail.get(r.email.toLowerCase()) ?? null,
    }));
  }
}

function paginate(opts: PageOpts) {
  const take = Math.min(MAX_LIMIT, Math.max(1, opts.limit ?? DEFAULT_LIMIT));
  const page = Math.max(1, opts.page ?? 1);
  return { take, page, skip: (page - 1) * take };
}

function iso(d: Date): string {
  return d.toISOString();
}

function cleanSearch(raw?: string): string | undefined {
  const s = raw?.trim().slice(0, SEARCH_MAX);
  return s || undefined;
}

function countMap(entries: Array<[string, number]>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, n] of entries) if (n > 0) out[k] = n;
  return out;
}

function startOfUtcDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

function parseDay(raw: string, field: string): Date {
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) throw new BadRequestException(`${field} must be an ISO date`);
  return startOfUtcDay(d);
}

/** Inclusive day bounds on UTC days: from 00:00 of `from`, up to end of `to`. */
function dateRange(from?: string, to?: string): Prisma.DateTimeFilter | undefined {
  if (!from && !to) return undefined;
  const range: Prisma.DateTimeFilter = {};
  if (from) range.gte = parseDay(from, 'from');
  if (to) {
    const end = new Date(parseDay(to, 'to').getTime() + DAY_MS);
    if (Number.isNaN(end.getTime())) throw new BadRequestException('to is out of range');
    range.lt = end;
  }
  if (range.gte && range.lt && range.gte >= range.lt) {
    throw new BadRequestException('from must not be after to');
  }
  return range;
}

function buildSignupSeries(start: Date, userDates: Date[], waitDates: Date[]) {
  const days = new Map<string, { date: string; users: number; waitlist: number }>();
  for (let i = 0; i < 30; i++) {
    const date = new Date(start.getTime() + i * DAY_MS).toISOString().slice(0, 10);
    days.set(date, { date, users: 0, waitlist: 0 });
  }
  for (const d of userDates) {
    const bucket = days.get(d.toISOString().slice(0, 10));
    if (bucket) bucket.users++;
  }
  for (const d of waitDates) {
    const bucket = days.get(d.toISOString().slice(0, 10));
    if (bucket) bucket.waitlist++;
  }
  return [...days.values()];
}
