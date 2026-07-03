import { Injectable, BadRequestException, NotFoundException, ForbiddenException } from '@nestjs/common';
import { createHash, randomBytes } from 'crypto';
import { PrismaService } from '../config/prisma.service';
import { ALLOWED_API_KEY_SCOPES } from './dto/api-key.dto';

@Injectable()
export class ApiKeyService {
  constructor(private prisma: PrismaService) {}

  /**
   * Generate a new API key for the given user.
   * Returns the plain-text key ONLY at creation time — it is never stored.
   * The database stores only the SHA-256 hash of the key.
   */
  async generateApiKey(userId: string, scopes: string[], advertiserId?: string, expiresAt?: string) {
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

    const apiKey = await this.prisma.apiKey.create({
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
    if (!keyPlain || typeof keyPlain !== 'string') {
      // Single opaque message — never disclose whether the key exists, is
      // revoked, or expired (those distinctions would let an attacker
      // enumerate key liveness).
      throw new BadRequestException('Invalid API key');
    }

    const keyHash = this.hashKey(keyPlain);
    const apiKey = await this.prisma.apiKey.findUnique({
      where: { keyHash },
    });

    if (!apiKey || !apiKey.isActive) {
      throw new BadRequestException('Invalid API key');
    }

    if (apiKey.expiresAt && apiKey.expiresAt < new Date()) {
      throw new BadRequestException('Invalid API key');
    }

    // Update lastUsedAt asynchronously — don't block the request on this
    this.prisma.apiKey
      .update({ where: { id: apiKey.id }, data: { lastUsedAt: new Date() } })
      .catch(() => {
        // silently ignore update failures (e.g. key was deleted between validation and update)
      });

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

    return this.prisma.apiKey.update({
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
  }

  // ── Private helpers ──

  private hashKey(plainKey: string): string {
    return createHash('sha256').update(plainKey).digest('hex');
  }
}