import * as bcrypt from 'bcryptjs';
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';

import { Prisma } from '@waitlayer/db';
import { DEFAULT_COMPANY_NAME } from '@waitlayer/shared';

import { AuditService } from '../audit/audit.service';
import { GoogleTokenVerifier } from '../auth/strategies/google-token-verifier';
import { getAdvertiserBalance } from '../common/utils/advertiser-balance';
import { buildCappedExportMeta, splitCappedRows } from '../common/utils/export-metadata';
import { normalizeOptionalPublicHttpsUrl } from '../common/utils/external-url-policy';
import { PrismaService } from '../config/prisma.service';
import { ADVERTISER_EXPORT_LIMITS } from './advertiser.constants';

export class AdvertiserProfileTrait {
  declare prisma: PrismaService;
  declare audit: AuditService;
  declare googleVerifier: GoogleTokenVerifier;

  /** Get or create advertiser profile for user */
  async getOrCreateProfile(userId: string) {
    const existing = await this.prisma.advertiser.findUnique({ where: { userId } });
    if (existing) return existing;
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');
    if (user.role !== 'advertiser') throw new ForbiddenException('Not an advertiser account');
    // Concurrent getOrCreateProfile calls for the same first-time user both pass the
    // findUnique check and both attempt the create. The @@unique([userId]) catches the
    // second via P2002 — translate so the caller sees a clean Conflict instead of a 500.
    try {
      return await this.prisma.advertiser.create({
        data: { userId, companyName: user.name || DEFAULT_COMPANY_NAME, billingEmail: user.email },
      });
    } catch (err: unknown) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        // Another call beat us — fetch and assert the winning row. Null here would
        // be a transient race after the P2002 (e.g. the winning row was deleted in
        // the gap), which is extraordinarily unlikely; we throw a clean 404 instead
        // of returning null and letting the caller `.id` it onto undefined.
        const winner = await this.prisma.advertiser.findUnique({ where: { userId } });
        if (!winner) throw new NotFoundException('Advertiser profile not found');
        return winner;
      }
      throw err;
    }
  }

  /** Resolve an advertiser by raw id — used by API-key auth where the key is
   *  scoped to a specific advertiser (no UserId lookup available). */
  async getProfileById(advertiserId: string) {
    const advertiser = await this.prisma.advertiser.findUnique({ where: { id: advertiserId } });
    if (!advertiser) throw new NotFoundException('Advertiser not found');
    return advertiser;
  }

  /**
   * A-044: self-service data export for advertisers. Mirrors the developer
   * export but scoped to advertiser-relevant data: profile, campaigns,
   * creatives, billing ledger, deposits/refunds, and consent records.
   */
  async exportData(userId: string) {
    const advertiser = await this.prisma.advertiser.findUnique({ where: { userId } });
    const advertiserId = advertiser?.id;
    const [user, campaignRows, creativeRows, ledgerRows, consents] = await Promise.all([
      this.prisma.user.findUnique({
        where: { id: userId },
        select: {
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
          referralCode: true,
          createdAt: true,
        },
      }),
      advertiserId
        ? this.prisma.campaign.findMany({
            where: { advertiserId },
            orderBy: { createdAt: 'desc' },
            take: ADVERTISER_EXPORT_LIMITS.campaigns + 1,
          })
        : [],
      advertiserId
        ? this.prisma.adCreative.findMany({
            where: { campaign: { advertiserId } },
            orderBy: { createdAt: 'desc' },
            take: ADVERTISER_EXPORT_LIMITS.creatives + 1,
          })
        : [],
      advertiserId
        ? this.prisma.advertiserLedger.findMany({
            where: { advertiserId },
            orderBy: { createdAt: 'desc' },
            take: ADVERTISER_EXPORT_LIMITS.billingLedger + 1,
          })
        : [],
      this.prisma.consent.findMany({ where: { userId }, orderBy: { createdAt: 'desc' } }),
    ]);
    const campaigns = splitCappedRows(campaignRows, ADVERTISER_EXPORT_LIMITS.campaigns);
    const creatives = splitCappedRows(creativeRows, ADVERTISER_EXPORT_LIMITS.creatives);
    const billingLedger = splitCappedRows(ledgerRows, ADVERTISER_EXPORT_LIMITS.billingLedger);
    const exportMeta = buildCappedExportMeta({
      campaigns: campaigns.meta,
      creatives: creatives.meta,
      billingLedger: billingLedger.meta,
    });
    void this.audit.log({
      actorId: userId,
      actorRole: 'advertiser',
      action: 'export_data',
      targetType: 'user',
      targetId: userId,
    });
    return {
      profile: user,
      advertiser,
      campaigns: campaigns.data,
      creatives: creatives.data,
      billingLedger: billingLedger.data,
      consent: consents,
      exportMeta,
    };
  }

  /**
   * A-044: self-service account deletion/erasure for advertisers. The
   * advertiser is also a User, so we anonymize both the User row and the
   * Advertiser profile, revoke sessions and API keys, and audit the action.
   * Money-retention/legal-hold rows (ledger, payouts) are intentionally left
   * intact for audit/compliance — only the personal identity is erased.
   */
  async deleteAccount(
    userId: string,
    options: {
      currentPassword?: string;
      googleIdToken?: string;
    } = {},
  ) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');
    // A-044: step-up reauthentication before irreversible erasure. A stolen
    // active session must not be able to delete the account with only a
    // typed confirmation string. Require either the current password (for
    // password accounts) or a fresh Google ID token (for social accounts).
    if (user.passwordHash) {
      if (!options.currentPassword) {
        throw new UnauthorizedException('Current password is required to delete your account');
      }
      const ok = await bcrypt.compare(options.currentPassword, user.passwordHash);
      if (!ok) {
        throw new UnauthorizedException('Current password is incorrect');
      }
    } else if (user.googleId) {
      if (!options.googleIdToken) {
        throw new UnauthorizedException(
          'Google reauthentication is required to delete your account',
        );
      }
      const payload = await this.googleVerifier.verify(options.googleIdToken);
      if (payload.sub !== user.googleId) {
        throw new UnauthorizedException(
          'Google reauthentication token does not match this account',
        );
      }
    } else {
      // No password and no Google link — extremely unlikely for a real account,
      // but fail closed rather than allow unauthenticated erasure.
      throw new UnauthorizedException('Unable to verify account ownership for deletion');
    }
    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: userId },
        data: {
          status: 'deleted',
          email: `deleted-${userId}@waitlayer.com`,
          passwordHash: null,
          googleId: null,
          githubId: null,
          googleVerified: false,
          githubVerified: false,
          emailVerified: false,
          twoFactorEnabled: false,
          twoFactorSecret: null,
          name: null,
          referralCode: null,
          country: null,
        },
      }),
      this.prisma.advertiser.updateMany({
        where: { userId },
        data: {
          companyName: 'Deleted Advertiser',
          billingEmail: `deleted-${userId}@waitlayer.com`,
          websiteUrl: null,
        },
      }),
      this.prisma.session.updateMany({ where: { userId }, data: { revoked: true } }),
      this.prisma.apiKey.updateMany({ where: { ownerId: userId }, data: { isActive: false } }),
    ]);
    void this.audit.log({
      actorId: userId,
      actorRole: 'advertiser',
      action: 'delete_account',
      targetType: 'user',
      targetId: userId,
    });
    return { deleted: true };
  }

  async createProfile(
    userId: string,
    dto: {
      companyName: string;
      billingEmail: string;
      websiteUrl?: string;
    },
  ) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');
    if (user.role !== 'advertiser') throw new ForbiddenException('Not an advertiser account');
    const existing = await this.prisma.advertiser.findUnique({ where: { userId } });
    if (existing) throw new BadRequestException('Advertiser profile already exists');
    // Concurrent createProfile calls race past the findUnique — the @@unique([userId])
    // catches the loser. Translate P2002 to ConflictException so the second caller
    // sees a clean 409, not a raw Prisma error leaked as a 500.
    try {
      const websiteUrl = normalizeOptionalPublicHttpsUrl(dto.websiteUrl, 'websiteUrl');
      const profile = await this.prisma.advertiser.create({
        data: { userId, companyName: dto.companyName, billingEmail: dto.billingEmail, websiteUrl },
      });
      void this.audit.log({
        actorId: userId,
        actorRole: 'advertiser',
        action: 'create_advertiser_profile',
        targetType: 'advertiser',
        targetId: profile.id,
      });
      return profile;
    } catch (err: unknown) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new BadRequestException('Advertiser profile already exists');
      }
      throw err;
    }
  }

  getAdvertiserBalance(advertiserId: string, currency: string): Promise<bigint> {
    return getAdvertiserBalance(this.prisma, advertiserId, currency);
  }
}
