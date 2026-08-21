import { BadRequestException, Injectable } from '@nestjs/common';

import { Prisma } from '@ateva/db';

import { AuditService } from '../audit/audit.service';
import { privacyPseudonym } from '../common/utils/privacy-hash';
import { PrismaService } from '../config/prisma.service';
import { CreateWaitlistDto } from './dto/waitlist.dto';

/**
 * Advertiser waitlist ingestion.
 *
 * The waitlist captures advertiser interest while billing is closed
 * (LAUNCH_PLAN Phase 2 step 11). Design rules:
 *
 * - **Idempotent on email.** Re-submission returns the existing row unchanged
 *   (200, `alreadySignedUp: true`) — the status an operator later sets
 *   (`invited`/`onboarded`/`declined`) is never overwritten by a duplicate
 *   signup, and a retried request cannot create a second row.
 * - **PII stays in one table.** The audit trail records targetType
 *   `advertiser_waitlist` + the row id and deliberately omits the email, so
 *   GDPR erasure is a single-row delete plus an indexed audit scrub
 *   (`scripts/erase-waitlist-signup.mjs`).
 * - **Consent is mandatory.** `consent: false` is refused; the stored flag
 *   documents that the address may be contacted.
 */
@Injectable()
export class WaitlistService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async submit(
    dto: CreateWaitlistDto,
    meta: { ip?: string; userAgent?: string },
  ): Promise<{ received: true; alreadySignedUp?: boolean }> {
    // Honeypot: a filled `website` field means an automated submitter.
    if (dto.website && dto.website.trim().length > 0) {
      throw new BadRequestException('Spam detected');
    }

    const email = dto.email.trim().toLowerCase();
    if (!email) {
      throw new BadRequestException('Email is required');
    }

    if (dto.consent !== true) {
      throw new BadRequestException(
        'Consent is required before we can add you to the advertiser waitlist',
      );
    }

    const existing = await this.prisma.advertiserWaitlist.findUnique({
      where: { email },
      select: { id: true, status: true, consent: true },
    });
    if (existing) {
      // Idempotent by design: a duplicate signup never mutates the row.
      return { received: true as const, alreadySignedUp: true };
    }

    let row: { id: string };
    try {
      row = await this.prisma.advertiserWaitlist.create({
        data: {
          email,
          company: dto.company?.trim() || null,
          country: dto.country?.trim().toUpperCase() || null,
          consent: true,
          source: 'advertisers_page',
          ipHash: meta.ip ? privacyPseudonym(meta.ip, 'waitlist-ip') : null,
        },
        select: { id: true },
      });
    } catch (error) {
      // Race between the findUnique above and this create: another concurrent
      // submit won the row. Treat it as the duplicate it is. Match on the
      // Prisma error class AND the bare code so driver-adapter envelopes that
      // do not extend the known class cannot re-surface a duplicate as a 500.
      const code = (error as { code?: unknown })?.code;
      if (
        (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') ||
        code === 'P2002'
      ) {
        return { received: true as const, alreadySignedUp: true };
      }
      throw error;
    }

    await this.audit.logStrict({
      actorId: 'anonymous',
      actorRole: 'anonymous',
      action: 'advertiser_waitlist_created',
      targetType: 'advertiser_waitlist',
      targetId: row.id,
      // Deliberately no email here — see class doc. The row id is the
      // correlation key for erasure and operator triage.
      afterSnap: {
        company: dto.company?.trim() || null,
        country: dto.country?.trim().toUpperCase() || null,
        consent: true,
        source: 'advertisers_page',
        hasEmail: true,
        userAgentFamily: coarseUserAgent(meta.userAgent),
      },
    });

    return { received: true as const };
  }

  /**
   * Admin listing (GET /admin/waitlist). Narrow select: never ipHash — the
   * pseudonym exists for write-time spam triage, not display. Bounded
   * pagination with the defensive A-121 parsing applied at the controller.
   */
  async listForAdmin(opts: {
    status?: 'pending' | 'invited' | 'onboarded' | 'declined';
    page?: number;
    limit?: number;
  }) {
    const take = Math.min(100, opts.limit ?? 50);
    const skip = Math.max(0, ((opts.page ?? 1) - 1) * take);
    const where = opts.status ? { status: opts.status } : undefined;

    const [rows, total] = await Promise.all([
      this.prisma.advertiserWaitlist.findMany({
        where,
        select: {
          id: true,
          email: true,
          company: true,
          country: true,
          status: true,
          consent: true,
          source: true,
          createdAt: true,
        },
        orderBy: { createdAt: 'desc' },
        take,
        skip,
      }),
      this.prisma.advertiserWaitlist.count({ where }),
    ]);

    return { rows, total, page: opts.page ?? 1, limit: take };
  }
}

function coarseUserAgent(userAgent?: string): string | undefined {
  if (!userAgent) return undefined;
  if (/Firefox/i.test(userAgent)) return 'Firefox';
  if (/Edg/i.test(userAgent)) return 'Edge';
  if (/Chrome|Chromium/i.test(userAgent)) return 'Chromium';
  if (/Safari/i.test(userAgent)) return 'Safari';
  return 'Other';
}
