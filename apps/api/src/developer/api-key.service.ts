import { createHash, randomBytes } from 'crypto';
import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';

import { AuditService } from '../audit/audit.service';
import { isActiveAccountStatus } from '../common/utils/account-status';
import { PrismaService } from '../config/prisma.service';
import {
  ALLOWED_API_KEY_SCOPES,
  REMOVED_SENSITIVE_API_KEY_SCOPES,
  UNSUPPORTED_API_KEY_SCOPES,
} from './dto/api-key.dto';

const REMOVED_SENSITIVE_SCOPE_SET = new Set<string>(REMOVED_SENSITIVE_API_KEY_SCOPES);
const UNSUPPORTED_SCOPE_SET = new Set<string>(UNSUPPORTED_API_KEY_SCOPES);
const ACTIVE_KEY_LIMIT = 20;
const KEY_HISTORY_LIMIT = 100;
const API_KEY_PATTERN = /^wl_[a-f0-9]{64}$/;

@Injectable()
export class ApiKeyService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
  ) {}

  /**
   * Generate a new API key for the given user.
   * Returns the plain-text key ONLY at creation time — it is never stored.
   * The database stores only the SHA-256 hash of the key.
   */
  async generateApiKey(userId: string, scopes: string[], advertiserId?: string, expiresAt?: string) {
    const owner = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { status: true, role: true },
    });
    if (!owner || !isActiveAccountStatus(owner.status)) {
      throw new ForbiddenException('Account is not eligible to create API keys');
    }

    // Reject unknown scopes at the service layer too — defense-in-depth on top
    // of the DTO enum check (scopes flow as `string[]` from the DTO).
    const allowed = new Set<string>(ALLOWED_API_KEY_SCOPES);
    for (const scope of scopes) {
      if (!allowed.has(scope)) {
        throw new BadRequestException(`Unknown scope: ${scope}`);
      }
    }

    // Defensive date validation: if `expiresAt` is provided but not a valid
    // date, `new Date(...)` would silently produce `Invalid Date` and the
    // key would never expire (the `expiresAt < new Date()` check would be
    // false for an Invalid Date). Reject malformed dates up front.
    let parsedExpiresAt: Date | null = null;
    if (expiresAt !== undefined && expiresAt !== null && expiresAt !== '') {
      const parsed = new Date(expiresAt);
      if (Number.isNaN(parsed.getTime())) {
        throw new BadRequestException('expiresAt must be a valid ISO 8601 date');
      }
      if (parsed.getTime() < Date.now()) {
        throw new BadRequestException('expiresAt must be in the future');
      }
      parsedExpiresAt = parsed;
    }

    // Ownership: `advertiserId` must belong to the requesting user. Without
    // this check a developer could mint an API key claiming ANY advertiser's
    // id and authenticate machine-to-machine calls as that advertiser.
    if (advertiserId) {
      const adv = await this.prisma.advertiser.findUnique({
        where: { id: advertiserId },
        select: { userId: true },
      });
      if (!adv || adv.userId !== userId) {
        throw new ForbiddenException('advertiserId does not belong to the requesting user');
      }
    }

    const plainKey = `wl_${randomBytes(32).toString('hex')}`;
    const keyHash = this.hashKey(plainKey);
    const keyPrefix = plainKey.slice(0, 10); // first 10 chars for display/identification

    const apiKey = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`api-key:${userId}`}, 0))`;
      const [activeCount, historyCount] = await Promise.all([
        tx.apiKey.count({
          where: {
            ownerId: userId,
            isActive: true,
            OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
          },
        }),
        tx.apiKey.count({ where: { ownerId: userId } }),
      ]);
      if (activeCount >= ACTIVE_KEY_LIMIT) {
        throw new BadRequestException(`At most ${ACTIVE_KEY_LIMIT} active API keys are allowed`);
      }
      if (historyCount >= KEY_HISTORY_LIMIT) {
        throw new BadRequestException(
          `API key history limit reached (${KEY_HISTORY_LIMIT}); contact support`,
        );
      }
      const created = await tx.apiKey.create({
        data: {
          ownerId: userId,
          advertiserId: advertiserId ?? null,
          keyHash,
          keyPrefix,
          scopes,
          isActive: true,
          expiresAt: parsedExpiresAt,
        },
      });
      await tx.auditLog.create({
        data: {
          actorId: userId,
          actorRole: owner.role,
          action: 'api_key_minted',
          targetType: 'api_key',
          targetId: created.id,
          afterSnap: {
            scopes,
            advertiserId: advertiserId ?? null,
            expiresAt: parsedExpiresAt?.toISOString() ?? null,
            keyPrefix,
          },
        },
      });
      return created;
    });

    // Return full details with the plain key — this is the ONLY time it is revealed
    return {
      id: apiKey.id,
      keyPrefix: apiKey.keyPrefix,
      scopes: apiKey.scopes,
      expiresAt: apiKey.expiresAt,
      createdAt: apiKey.createdAt,
      plainKey, // only returned once at creation
    };
  }

  /**
   * Validate an API key from the X-Api-Key header.
   * Returns the ApiKey record if valid (active, not expired, scopes match).
   */
  async validateApiKey(keyPlain: string) {
    if (!keyPlain || typeof keyPlain !== 'string' || !API_KEY_PATTERN.test(keyPlain)) {
      // Single opaque message — never disclose whether the key exists, is
      // revoked, or expired (those distinctions would let an attacker
      // enumerate key liveness).
      throw new BadRequestException('Invalid API key');
    }

    const keyHash = this.hashKey(keyPlain);
    const apiKey = await this.prisma.apiKey.findUnique({
      where: { keyHash },
      include: {
        owner: {
          select: { id: true, status: true, trustLevel: true, role: true },
        },
      },
    });

    if (!apiKey || !apiKey.isActive) {
      throw new BadRequestException('Invalid API key');
    }

    if (apiKey.expiresAt && apiKey.expiresAt < new Date()) {
      throw new BadRequestException('Invalid API key');
    }

    // Reject keys whose owner has been restricted, soft-deleted, or banned. A deleted
    // user's keys may have ownerId set to NULL by the FK SET NULL or may
    // still reference a row with status='deleted'. Either case invalidates
    // the key — the credential lives as long as the user does.
    if (!apiKey.owner || !isActiveAccountStatus(apiKey.owner.status)) {
      throw new BadRequestException('Invalid API key');
    }

    // Legacy/manual rows may still carry scopes that current self-service
    // issuance deliberately forbids or that no API-key route supports anymore.
    // Reject them at validation time so old long-lived keys cannot reach
    // money/privacy routes or keep pretending to work for extension/CLI auth.
    if (
      apiKey.scopes.some((scope) => (
        REMOVED_SENSITIVE_SCOPE_SET.has(scope) || UNSUPPORTED_SCOPE_SET.has(scope)
      ))
    ) {
      throw new BadRequestException('Invalid API key');
    }

    // Update lastUsedAt asynchronously, throttled to once per 60s — at peak
    // a service-to-service client can hit the API hundreds of times per
    // second, and every write is a DB row update on the hot path. A
    // 60-second granularity gives the audit log a useful freshness signal
    // without scaling writes linearly with request volume. The non-blocking
    // `void … .catch(...)` keeps the response unaffected when the throttle
    // fires (and never bubbles errors to the caller).
    const now = new Date();
    const lastWrite = apiKey.lastUsedAt?.getTime() ?? 0;
    if (now.getTime() - lastWrite > 60_000) {
      void this.prisma.apiKey
        .update({
          where: { id: apiKey.id },
          data: { lastUsedAt: now },
        })
        .catch(() => {
          // silently ignore update failures (e.g. key was deleted between validation and update)
        });
    }

    return apiKey;
  }

  /**
   * List API keys for a user — never returns the plain key or hash.
   */
  async listApiKeys(userId: string) {
    return this.prisma.apiKey.findMany({
      where: { ownerId: userId },
      select: {
        id: true,
        keyPrefix: true,
        scopes: true,
        isActive: true,
        advertiserId: true,
        lastUsedAt: true,
        createdAt: true,
        expiresAt: true,
      },
      orderBy: { createdAt: 'desc' },
      take: KEY_HISTORY_LIMIT,
    });
  }

  /**
   * Revoke an API key (mark as inactive).
   */
  async revokeApiKey(keyId: string, userId: string) {
    const apiKey = await this.prisma.apiKey.findUnique({
      where: { id: keyId },
    });

    if (!apiKey) {
      throw new NotFoundException('API key not found');
    }

    if (apiKey.ownerId !== userId) {
      throw new ForbiddenException('You can only revoke your own API keys');
    }

    const revoked = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.apiKey.update({
        where: { id: keyId },
        data: { isActive: false },
        select: {
          id: true,
          keyPrefix: true,
          scopes: true,
          isActive: true,
          createdAt: true,
          expiresAt: true,
        },
      });
      await tx.auditLog.create({
        data: {
          actorId: userId,
          actorRole: 'developer',
          action: 'api_key_revoked',
          targetType: 'api_key',
          targetId: keyId,
          afterSnap: { keyPrefix: updated.keyPrefix },
        },
      });
      return updated;
    });

    return revoked;
  }

  // ── Private helpers ──

  private hashKey(plainKey: string): string {
    return createHash('sha256').update(plainKey).digest('hex');
  }
}
