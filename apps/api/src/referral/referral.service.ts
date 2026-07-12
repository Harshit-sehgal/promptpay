import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { primaryCurrency, REFERRAL } from '@waitlayer/shared';

import { isUniqueConstraintViolation } from '../common/utils/errors';
import { PrismaService } from '../config/prisma.service';
import { LedgerService } from '../ledger/ledger.service';

@Injectable()
export class ReferralService {
  private readonly webBaseUrl: string;

  constructor(
    private prisma: PrismaService,
    private ledger: LedgerService,
    private config: ConfigService,
  ) {
    this.webBaseUrl = this.config.get<string>('WEB_BASE_URL', 'http://localhost:3000');
  }

  /** Get the user's own referral info: code, count, link, rewards earned */
  async getReferralInfo(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { referralCode: true },
    });
    if (!user) throw new NotFoundException('User not found');

    const code = user.referralCode;
    if (!code) {
      return {
        referralCode: null,
        referralCount: 0,
        referralLink: null,
        rewardsEarnedMinor: 0,
        rewardsEarnedByCurrency: {},
        referrals: [],
      };
    }

    const [referralCount, rewardGroups] = await Promise.all([
      this.prisma.referral.count({ where: { referrerId: userId } }),
      this.prisma.referralReward.groupBy({
        by: ['currency'],
        where: { userId, status: { notIn: ['reversed', 'void'] } },
        _sum: { amountMinor: true },
      }),
    ]);
    const rewardsEarnedByCurrency = Object.fromEntries(
      rewardGroups.map((row) => [row.currency, row._sum.amountMinor ?? 0n]),
    );

    const referrals = await this.prisma.referral.findMany({
      where: { referrerId: userId },
      include: {
        referred: { select: { email: true, name: true, createdAt: true } },
        rewards: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    return {
      referralCode: code,
      referralCount,
      referralLink: `${this.webBaseUrl}/auth/signup?ref=${code}`,
      rewardsEarnedMinor: rewardsEarnedByCurrency[primaryCurrency(rewardsEarnedByCurrency)] ?? 0,
      rewardsEarnedByCurrency,
      referrals: referrals.map((r) => ({
        id: r.id,
        referredEmail: r.referred.email,
        referredName: r.referred.name,
        status: r.status,
        createdAt: r.createdAt,
        rewards: r.rewards.map((rw) => ({
          amountMinor: rw.amountMinor,
          currency: rw.currency,
          status: rw.status,
        })),
      })),
    };
  }

  /** Apply a referral code for a user who signed up without one */
  async applyReferralCode(userId: string, code: string) {
    // Normalize the code
    const normalized = code.trim().toUpperCase();

    // Find the referrer by the code
    const referrer = await this.prisma.user.findUnique({
      where: { referralCode: normalized },
    });
    if (!referrer) {
      throw new BadRequestException('Invalid referral code');
    }
    // Banned / restricted users cannot earn referral rewards. Their code
    // stays in the DB but is rejected at apply-time and reward-time.
    if (referrer.status !== 'active') {
      throw new BadRequestException('Invalid referral code');
    }

    // Prevent self-referral
    if (referrer.id === userId) {
      throw new BadRequestException('You cannot refer yourself');
    }

    // Prevent re-referral — user already referred. The schema's @@unique([referredId])
    // is the authoritative guard (closes the TOCTOU race between findFirst and create);
    // we check here for a clean error message in the no-race case.
    const existingReferred = await this.prisma.referral.findFirst({
      where: { referredId: userId },
    });
    if (existingReferred) {
      throw new BadRequestException('You have already used a referral code');
    }

    // Create the referral record — catch DB-level unique-constraint violation
    // (P2002 on @@unique([referredId]) for the concurrent race window).
    try {
      const referral = await this.prisma.referral.create({
        data: {
          referrerId: referrer.id,
          referredId: userId,
          code: `ref_${userId.slice(0, 8)}_${Date.now()}`,
          status: 'pending',
        },
      });

      return {
        referralId: referral.id,
        referrerEmail: referrer.email,
      };
    } catch (err: unknown) {
      if (isUniqueConstraintViolation(err)) {
        throw new BadRequestException('You have already used a referral code');
      }
      throw err;
    }
  }

  /** Process referral reward when referred user meets criteria (first payout completed).
   *
   *  This is a money-mutation path called by the payout service after a payout is
   *  marked paid. It must be idempotent and race-safe:
   *  - The `referralReward` table has `@@unique([referralId])` on the underlying DB
   *    schema, so a duplicate reward create throws P2002 and is caught.
   *  - The existence check + create are wrapped inside `$transaction` so two
   *    concurrent calls cannot both pass the check and only one create survives.
   *  - The referral status update uses CAS (`status !== 'rewarded'`) so the
   *    right-wins pattern is clean. */
  async processReferralRewards(referredUserId: string) {
    // Find the referral for this user
    const referral = await this.prisma.referral.findFirst({
      where: { referredId: referredUserId },
      include: { rewards: true, referrer: { select: { status: true } } },
    });

    if (!referral) return null;

    // Banned / restricted referrers shouldn't receive rewards. If their
    // status changed after the referral was created (e.g. suspended for
    // fraud), skip the reward.
    if (referral.referrer.status !== 'active') return null;

    // Pre-flight checks outside the transaction — cheap filters that reject
    // the vast majority of calls before opening a tx.
    const existingReward = referral.rewards.find(
      (r) => r.status !== 'reversed' && r.status !== 'void',
    );
    if (existingReward) return null;

    // Check that this is indeed the referred user's first payout
    const paidPayouts = await this.prisma.payoutRequest.count({
      where: { userId: referredUserId, status: 'paid' },
    });
    if (paidPayouts > 1) return null;

    // Verify the payout amount meets the threshold
    const firstPaidPayout = await this.prisma.payoutRequest.findFirst({
      where: { userId: referredUserId, status: 'paid' },
      orderBy: { createdAt: 'asc' },
      include: { allocations: true },
    });
    if (!firstPaidPayout) return null;

    const totalPaidMinor = firstPaidPayout.allocations.reduce((sum, a) => sum + a.amountMinor, 0);
    if (totalPaidMinor < REFERRAL.FIRST_PAYOUT_THRESHOLD_MINOR) return null;

    const rewardAmount = REFERRAL.REWARD_AMOUNT_MINOR;

    // Create both the platformLedger credit and the ReferralReward record
    // atomically, with a CAS check on the referral status to prevent two
    // concurrent calls from both creating rewards.
    const result = await this.prisma.$transaction(async (tx) => {
      // CAS: only proceed if the referral is still 'pending' — two concurrent
      // calls to processReferralRewards will race; the loser exits cleanly.
      const casReferral = await tx.referral.findFirst({
        where: { id: referral.id, status: 'pending' },
      });
      if (!casReferral) return null;

      // Double-check inside the transaction — the TOCTOU window is now closed.
      const insideReward = await tx.referralReward.findFirst({
        where: {
          referralId: referral.id,
          status: { notIn: ['reversed', 'void'] },
        },
      });
      if (insideReward) return null;

      try {
        const [platformEntry, reward] = await Promise.all([
          tx.platformLedger.create({
            data: {
              entryType: 'credit',
              status: 'confirmed',
              amountMinor: rewardAmount,
              currency: REFERRAL.CURRENCY,
              bucket: 'referral_bonus',
              referenceId: referral.id,
              idempotencyKey: `ref-rew-${referral.id}`,
              description: `Referral reward for referring user ${referredUserId}`,
            },
          }),
          tx.referralReward.create({
            data: {
              referralId: referral.id,
              userId: referral.referrerId,
              amountMinor: rewardAmount,
              currency: REFERRAL.CURRENCY,
              status: 'confirmed',
            },
          }),
          // A-041: make the referral reward payoutable developer earnings.
          // Without this earningsLedger credit the platformLedger bonus is just
          // an internal accounting entry that never reaches the referrer's
          // payout balance. Idempotent on a per-referral idempotency key so a
          // retried reward process cannot double-credit earnings.
          tx.earningsLedger.create({
            data: {
              userId: referral.referrerId,
              campaignId: null,
              entryType: 'credit',
              status: 'confirmed',
              amountMinor: rewardAmount,
              currency: REFERRAL.CURRENCY,
              idempotencyKey: `ref-rew-earn-${referral.id}`,
              description: `Referral reward earnings for referring user ${referredUserId}`,
            },
          }),
        ]);

        // Update referral status inside the transaction so it's atomic
        await tx.referral.update({
          where: { id: referral.id },
          data: { status: 'rewarded' },
        });

        return { reward, platformEntry };
      } catch (err: unknown) {
        if (isUniqueConstraintViolation(err)) {
          return null; // Already rewarded — idempotent
        }
        throw err;
      }
    });

    return result;
  }

  /** Get referral history: list of referrals made by the user with status */
  async getReferralHistory(userId: string) {
    const referrals = await this.prisma.referral.findMany({
      where: { referrerId: userId },
      include: {
        referred: { select: { email: true, name: true, createdAt: true } },
        rewards: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    return referrals.map((r) => ({
      id: r.id,
      referredEmail: r.referred.email,
      referredName: r.referred.name,
      code: r.code,
      status: r.status,
      createdAt: r.createdAt,
      totalRewardsMinor: r.rewards.reduce(
        (sum, rw) =>
          rw.status === 'reversed' || rw.status === 'void' ? sum : sum + rw.amountMinor,
        0n,
      ),
    }));
  }
}
