import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { createHash, randomBytes } from 'crypto';
import { PrismaService } from '../config/prisma.service';

@Injectable()
export class ApiKeyService {
  constructor(private prisma: PrismaService) {}

  /**
   * Generate a new API key for the given user.
   * Returns the plain-text key ONLY at creation time — it is never stored.
   * The database stores only the SHA-256 hash of the key.
   */
  async generateApiKey(userId: string, scopes: string[], advertiserId?: string, expiresAt?: string) {
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
        expiresAt: expiresAt ? new Date(expiresAt) : null,
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
      throw new BadRequestException('Invalid API key format');
    }

    const keyHash = this.hashKey(keyPlain);
    const apiKey = await this.prisma.apiKey.findUnique({
      where: { keyHash },
    });

    if (!apiKey) {
      throw new BadRequestException('Invalid API key');
    }

    if (!apiKey.isActive) {
      throw new BadRequestException('API key has been revoked');
    }

    if (apiKey.expiresAt && apiKey.expiresAt < new Date()) {
      throw new BadRequestException('API key has expired');
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
      throw new BadRequestException('You can only revoke your own API keys');
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