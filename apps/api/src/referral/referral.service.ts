import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../config/prisma.service';
import { LedgerService } from '../ledger/ledger.service';
import { REFERRAL } from '@waitlayer/shared';

@Injectable()
export class ReferralService {
  constructor(
    private prisma: PrismaService,
    private ledger: LedgerService,
  ) {}

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
        referrals: [],
      };
    }

    const [referralCount, rewardsAgg] = await Promise.all([
      this.prisma.referral.count({ where: { referrerId: userId } }),
      this.prisma.referralReward.aggregate({
        where: { userId },
        _sum: { amountMinor: true },
      }),
    ]);

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
      referralLink: `${process.env.WEB_BASE_URL || 'http://localhost:3000'}/auth/signup?ref=${code}`,
      rewardsEarnedMinor: rewardsAgg._sum.amountMinor || 0,
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

    // Prevent self-referral
    if (referrer.id === userId) {
      throw new BadRequestException('You cannot refer yourself');
    }

    // Prevent re-referral — user already referred
    const existingReferred = await this.prisma.referral.findFirst({
      where: { referredId: userId },
    });
    if (existingReferred) {
      throw new BadRequestException('You have already used a referral code');
    }

    // Create the referral record
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
  }

  /** Process referral reward when referred user meets criteria (first payout completed) */
  async processReferralRewards(referredUserId: string) {
    // Find the referral for this user
    const referral = await this.prisma.referral.findFirst({
      where: { referredId: referredUserId },
      include: { rewards: true },
    });

    if (!referral) return null;

    // Check if reward already issued for this referral
    const existingReward = referral.rewards.find(
      (r) => r.status !== 'reversed' && r.status !== 'void',
    );
    if (existingReward) return null;

    // Check that this is indeed the referred user's first payout
    const paidPayouts = await this.prisma.payoutRequest.count({
      where: {
        userId: referredUserId,
        status: 'paid',
      },
    });

    // Only reward on the first payout
    if (paidPayouts > 1) return null;

    // Verify the payout amount meets the threshold
    const firstPaidPayout = await this.prisma.payoutRequest.findFirst({
      where: { userId: referredUserId, status: 'paid' },
      orderBy: { createdAt: 'asc' },
      include: { allocations: true },
    });

    if (!firstPaidPayout) return null;

    const totalPaidMinor = firstPaidPayout.allocations.reduce(
      (sum, a) => sum + a.amountMinor,
      0,
    );

    if (totalPaidMinor < REFERRAL.FIRST_PAYOUT_THRESHOLD_MINOR) return null;

    const rewardAmount = REFERRAL.REWARD_AMOUNT_MINOR;

    // Create both the platformLedger credit and the ReferralReward record atomically
    const [platformEntry, reward] = await this.prisma.$transaction([
      this.prisma.platformLedger.create({
        data: {
          entryType: 'credit',
          status: 'confirmed',
          amountMinor: rewardAmount,
          currency: REFERRAL.CURRENCY,
          bucket: 'referral_bonus',
          referenceId: referral.id,
          idempotencyKey: `ref-rew-${referral.id}-${Date.now()}`,
          description: `Referral reward for referring user ${referredUserId}`,
        },
      }),
      this.prisma.referralReward.create({
        data: {
          referralId: referral.id,
          userId: referral.referrerId,
          amountMinor: rewardAmount,
          currency: REFERRAL.CURRENCY,
          status: 'confirmed',
        },
      }),
    ]);

    // Update referral status
    await this.prisma.referral.update({
      where: { id: referral.id },
      data: { status: 'rewarded' },
    });

    return { reward, platformEntry };
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
        (sum, rw) => (rw.status === 'reversed' || rw.status === 'void' ? sum : sum + rw.amountMinor),
        0,
      ),
    }));
  }
}
