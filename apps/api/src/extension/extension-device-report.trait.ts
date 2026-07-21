import * as bcrypt from 'bcryptjs';
import * as crypto from 'crypto';
import { LRUCache } from 'lru-cache';
import {
  BadRequestException,
  ForbiddenException,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';

import { ToolTypeEnum } from '@waitlayer/db';
import { PROHIBITED_DATA_FIELDS, verifySignature } from '@waitlayer/shared';

import { AuditService } from '../audit/audit.service';
import { GoogleTokenVerifier } from '../auth/strategies/google-token-verifier';
import { getAdvertiserBalance } from '../common/utils/advertiser-balance';
import { PrismaService } from '../config/prisma.service';
import { FraudService } from '../fraud/fraud.service';
import { LedgerService } from '../ledger/ledger.service';
import { RuntimeConfigService } from '../runtime-config/runtime-config.service';
import { hashDeviceRecoveryToken, hasMatchingSecret } from './extension.constants';

export class ExtensionDeviceReportTrait {
  declare prisma: PrismaService;
  declare audit: AuditService;
  declare fraud: FraudService;
  declare ledger: LedgerService;
  declare googleVerifier: GoogleTokenVerifier;
  declare runtimeConfig: RuntimeConfigService;
  declare logger: Logger;
  declare recentAuditRejections: LRUCache<string, boolean>;

  // ── Device Registration ──
  async registerDevice(
    userId: string,
    dto: {
      toolType: string;
      fingerprintHash: string;
      extensionVersion?: string;
      platform?: string;
      publicKey?: string;
      existingEventSecret?: string;
      recoveryPassword?: string;
      recoveryGoogleIdToken?: string;
      recoverySupportToken?: string;
    },
  ) {
    // Privacy: reject payloads containing prohibited data fields
    this.enforcePrivacyOn(dto);
    // Runtime kill-switch: tool integration and extension version
    if (!(await this.runtimeConfig.isToolEnabled(dto.toolType))) {
      throw new ForbiddenException(`Tool integration "${dto.toolType}" is currently disabled`);
    }
    if (!(await this.runtimeConfig.isExtensionVersionAllowed(dto.extensionVersion))) {
      throw new ForbiddenException('Extension version is blocked or below the minimum version');
    }
    // Enforce minimum extension version for the requested tool.
    await this.assertMinimumExtensionVersion(dto.toolType, dto.extensionVersion);
    // Check for duplicate device (same user + same fingerprint = re-registration).
    const existingDevice = await this.prisma.device.findUnique({
      where: { userId_fingerprintHash: { userId, fingerprintHash: dto.fingerprintHash } },
    });
    if (existingDevice) {
      if (!existingDevice.eventSecret) {
        // Legacy rows created before per-device secrets cannot authenticate
        // event payloads anymore. Issue a one-time secret to the authenticated
        // same-user owner so the device can migrate without keeping the global
        // HMAC fallback alive.
        const migratedSecret = crypto.randomBytes(32).toString('hex');
        const updated = await this.prisma.device.update({
          where: { id: existingDevice.id },
          data: {
            toolType: dto.toolType as ToolTypeEnum,
            extensionVersion: dto.extensionVersion,
            platform: dto.platform,
            eventSecret: migratedSecret,
            lastSeenAt: new Date(),
          },
        });
        await this.audit.log({
          actorId: userId,
          actorRole: 'developer',
          action: 'legacy_device_secret_issued',
          targetType: 'device',
          targetId: existingDevice.id,
          afterSnap: { fingerprintHash: dto.fingerprintHash },
        });
        return { ...updated, eventSecret: migratedSecret };
      }
      // Re-registration rotates the per-device secret. Any leaked token from
      // the old extension install is invalidated by this one-time reveal.
      //
      // CRITICAL: require proof-of-possession of the previously-issued secret
      // before rotating. If the local secret was lost during reinstall, allow
      // a deliberately stronger recovery path: same authenticated user, same
      // fingerprint, and fresh account re-authentication. Password accounts
      // prove that with the account password; linked Google accounts prove it
      // with a matching Google ID token; support/admin can issue a short-lived
      // one-time recovery token for future non-Google passwordless accounts.
      // That avoids restoring the removed global-HMAC fallback while still
      // giving real users a way out.
      const hasExistingSecretProof = hasMatchingSecret(
        dto.existingEventSecret,
        existingDevice.eventSecret,
      );
      let recoveryMode: 'event_secret' | 'password' | 'google' | 'support' = 'event_secret';
      if (!hasExistingSecretProof) {
        recoveryMode = await this.assertDeviceRecoveryProof(userId, dto, existingDevice.id);
      }
      const rotatedSecret = crypto.randomBytes(32).toString('hex');
      const updateData = {
        toolType: dto.toolType as ToolTypeEnum,
        extensionVersion: dto.extensionVersion,
        platform: dto.platform,
        eventSecret: rotatedSecret,
        lastSeenAt: new Date(),
      };
      const updated =
        recoveryMode === 'support'
          ? await this.consumeSupportRecoveryAndRotate(
              userId,
              existingDevice.id,
              dto.recoverySupportToken!,
              updateData,
            )
          : await this.prisma.device.update({
              where: { id: existingDevice.id },
              data: updateData,
            });
      await this.audit.log({
        actorId: userId,
        actorRole: 'developer',
        action:
          recoveryMode === 'event_secret' ? 'device_secret_rotated' : 'device_secret_recovered',
        targetType: 'device',
        targetId: existingDevice.id,
        afterSnap: { recoveryMode },
      });
      return { ...updated, eventSecret: rotatedSecret };
    }
    // Cross-user fingerprint handling (P1). The global unique constraint on
    // fingerprintHash has been removed. Instead of blocking registration, a
    // cross-user collision is treated as a high-severity fraud signal, the
    // new account's trust level is restricted, and the case is queued for
    // manual review via the fraud flag. The device is still created so the
    // legitimate (or attacker) flow is not hard-blocked at registration time.
    const existingOwner = await this.prisma.device.findFirst({
      where: { fingerprintHash: dto.fingerprintHash, NOT: { userId } },
      select: { userId: true, id: true },
    });
    const eventSecret = crypto.randomBytes(32).toString('hex');
    const device = await this.prisma.device.create({
      data: {
        userId,
        fingerprintHash: dto.fingerprintHash,
        eventSecret,
        toolType: dto.toolType as ToolTypeEnum,
        extensionVersion: dto.extensionVersion,
        platform: dto.platform,
        publicKey: dto.publicKey,
      },
    });
    if (existingOwner) {
      // Flag the collision and restrict the new account's trust immediately.
      // Fire-and-forget fraud/audit paths must not fail registration.
      void this.fraud.checkDuplicateDevice(dto.fingerprintHash, userId).catch(() => undefined);
      void this.prisma.user
        .updateMany({
          where: { id: userId, trustLevel: { not: 'restricted' } },
          data: { trustLevel: 'restricted' },
        })
        .catch(() => undefined);
      void this.audit.log({
        actorId: userId,
        actorRole: 'developer',
        action: 'duplicate_device_allowed_restricted',
        targetType: 'device',
        targetId: device.id,
        afterSnap: { fingerprintHash: dto.fingerprintHash, existingUserId: existingOwner.userId },
      });
    }
    // Non-blocking fraud signals on successful device registration
    void this.fraud
      .checkVpnProxyPattern(userId, device.id, dto.platform ?? null)
      .catch(() => undefined);
    void this.fraud
      .checkEmulatorVmPattern(userId, device.id, dto.platform ?? null)
      .catch(() => undefined);
    void this.fraud.checkDuplicateAccount(userId).catch(() => undefined);
    return { ...device, eventSecret };
  }

  async assertDeviceRecoveryProof(
    userId: string,
    dto: {
      recoveryPassword?: string;
      recoveryGoogleIdToken?: string;
      recoverySupportToken?: string;
    },
    deviceId: string,
  ): Promise<'password' | 'google' | 'support'> {
    const proofCount = [
      dto.recoveryPassword,
      dto.recoveryGoogleIdToken,
      dto.recoverySupportToken,
    ].filter(Boolean).length;
    if (proofCount === 0) {
      throw new UnauthorizedException(
        'Cannot recover device secret without the existing device secret, account password, Google re-auth token, or support recovery token',
      );
    }
    if (proofCount > 1) {
      throw new BadRequestException('Provide only one device recovery proof');
    }
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { passwordHash: true, googleId: true, email: true },
    });
    if (!user) {
      await this.audit.log({
        actorId: userId,
        actorRole: 'developer',
        action: 'device_secret_recovery_rejected',
        targetType: 'device',
        targetId: deviceId,
        afterSnap: { reason: 'user_not_found' },
      });
      throw new UnauthorizedException('Device recovery user was not found');
    }
    if (dto.recoveryPassword) {
      if (!user.passwordHash) {
        await this.audit.log({
          actorId: userId,
          actorRole: 'developer',
          action: 'device_secret_recovery_rejected',
          targetType: 'device',
          targetId: deviceId,
          afterSnap: { reason: 'password_unavailable' },
        });
        throw new UnauthorizedException(
          'Password re-authentication is required to recover this device',
        );
      }
      const passwordOk = await bcrypt.compare(dto.recoveryPassword, user.passwordHash);
      if (!passwordOk) {
        await this.audit.log({
          actorId: userId,
          actorRole: 'developer',
          action: 'device_secret_recovery_rejected',
          targetType: 'device',
          targetId: deviceId,
          afterSnap: { reason: 'password_mismatch' },
        });
        throw new UnauthorizedException('Password re-authentication failed');
      }
      return 'password';
    }
    if (dto.recoveryGoogleIdToken) {
      if (!user.googleId) {
        await this.audit.log({
          actorId: userId,
          actorRole: 'developer',
          action: 'device_secret_recovery_rejected',
          targetType: 'device',
          targetId: deviceId,
          afterSnap: { reason: 'google_unavailable' },
        });
        throw new UnauthorizedException(
          'Google re-authentication is not available for this account',
        );
      }
      const googlePayload = await this.googleVerifier.verify(dto.recoveryGoogleIdToken);
      if (
        !googlePayload.email_verified ||
        googlePayload.sub !== user.googleId ||
        googlePayload.email !== user.email
      ) {
        await this.audit.log({
          actorId: userId,
          actorRole: 'developer',
          action: 'device_secret_recovery_rejected',
          targetType: 'device',
          targetId: deviceId,
          afterSnap: {
            reason: 'google_mismatch',
            googleSub: googlePayload.sub,
            googleEmail: googlePayload.email,
          },
        });
        throw new UnauthorizedException('Google re-authentication failed');
      }
      return 'google';
    }
    const tokenHash = hashDeviceRecoveryToken(dto.recoverySupportToken!);
    const recoveryToken = await this.prisma.deviceRecoveryToken.findUnique({
      where: { tokenHash },
      select: {
        id: true,
        userId: true,
        deviceId: true,
        expiresAt: true,
        usedAt: true,
        revokedAt: true,
      },
    });
    const now = new Date();
    if (
      !recoveryToken ||
      recoveryToken.userId !== userId ||
      recoveryToken.deviceId !== deviceId ||
      recoveryToken.usedAt ||
      recoveryToken.revokedAt ||
      recoveryToken.expiresAt <= now
    ) {
      await this.audit.log({
        actorId: userId,
        actorRole: 'developer',
        action: 'device_secret_recovery_rejected',
        targetType: 'device',
        targetId: deviceId,
        afterSnap: { reason: 'support_token_invalid_or_expired' },
      });
      throw new UnauthorizedException('Support recovery token is invalid or expired');
    }
    return 'support';
  }

  /**
   * Atomically consume the one-time support token and rotate the device secret.
   * If the device write fails, PostgreSQL rolls the token's usedAt change back,
   * so an operator-issued recovery credential is never burned without actually
   * restoring the device.
   */
  async consumeSupportRecoveryAndRotate(
    userId: string,
    deviceId: string,
    supportToken: string,
    updateData: {
      toolType: ToolTypeEnum;
      extensionVersion?: string;
      platform?: string;
      eventSecret: string;
      lastSeenAt: Date;
    },
  ) {
    const tokenHash = hashDeviceRecoveryToken(supportToken);
    const now = new Date();
    try {
      return await this.prisma.$transaction(async (tx) => {
        const recoveryToken = await tx.deviceRecoveryToken.findUnique({
          where: { tokenHash },
          select: {
            id: true,
            userId: true,
            deviceId: true,
            expiresAt: true,
            usedAt: true,
            revokedAt: true,
          },
        });
        if (
          !recoveryToken ||
          recoveryToken.userId !== userId ||
          recoveryToken.deviceId !== deviceId ||
          recoveryToken.usedAt ||
          recoveryToken.revokedAt ||
          recoveryToken.expiresAt <= now
        ) {
          throw new UnauthorizedException('Support recovery token is invalid or expired');
        }
        const consumed = await tx.deviceRecoveryToken.updateMany({
          where: {
            id: recoveryToken.id,
            userId,
            deviceId,
            tokenHash,
            usedAt: null,
            revokedAt: null,
            expiresAt: { gt: now },
          },
          data: { usedAt: now },
        });
        if (consumed.count !== 1) {
          throw new UnauthorizedException('Support recovery token is invalid or expired');
        }
        return tx.device.update({ where: { id: deviceId }, data: updateData });
      });
    } catch (error) {
      if (error instanceof UnauthorizedException) {
        await this.audit.log({
          actorId: userId,
          actorRole: 'developer',
          action: 'device_secret_recovery_rejected',
          targetType: 'device',
          targetId: deviceId,
          afterSnap: { reason: 'support_token_invalid_or_race_lost' },
        });
      }
      throw error;
    }
  }

  async reportAd(
    userId: string,
    dto: {
      impressionToken: string;
      reason: string;
      details?: string;
      signature: string;
    },
  ) {
    this.enforcePrivacyOn(dto);
    const hash = crypto.createHash('sha256').update(dto.impressionToken).digest('hex');
    const impression = await this.prisma.adImpression.findUnique({
      where: { impressionTokenHash: hash },
    });
    if (!impression) throw new NotFoundException('Impression not found');
    if (impression.userId !== userId) {
      throw new ForbiddenException('You do not own this impression');
    }
    // Verify device signature — otherwise an attacker who learns an impressionToken
    // could invalidate a legitimate impression and block the owner's earnings.
    const { signature: _, ...payload } = dto;
    if (!(await this.verifyDeviceSignature(impression.deviceId, payload, dto.signature))) {
      throw new ForbiddenException('Invalid request signature');
    }
    // Create the report once and invalidate the impression. If the impression was
    // billed, we must also reverse the ledger
    // entries — otherwise the advertiser stays debited, the developer keeps
    // earnings, and platform keeps fee + fraud_reserve for an impression we
    // now believe was invalid (3-way money orphan). reverseEarnings is
    // idempotent (deterministic reversal keys with upsert no-op), so it MUST be
    // retried even after isBillable was already flipped false. The old guard on
    // the snapshot value permanently skipped compensation when the first
    // reversal attempt failed after the report transaction committed.
    // AdReport now has @@unique([impressionId, userId]). The
    // old findFirst + conditional create raced on concurrent reportAd →
    // both inserts succeeded (no unique guard), creating duplicate rows.
    // Now wrap in try/catch for P2002: the DB unique is the floor.
    // ReverseEarnings is already idempotent (deterministic reversal-key
    // upsert), so money is safe regardless.
    let report = await this.prisma.adReport.findUnique({
      where: { impressionId_userId: { impressionId: impression.id, userId } },
    });
    if (!report) {
      try {
        [report] = await this.prisma.$transaction([
          this.prisma.adReport.create({
            data: {
              impressionId: impression.id,
              creativeId: impression.creativeId,
              userId,
              reason: dto.reason,
              details: dto.details,
            },
          }),
          this.prisma.adImpression.update({
            where: { id: impression.id },
            data: {
              isBillable: false,
              invalidationReason: `user_reported:${dto.reason}`,
              invalidatedAt: new Date(),
            },
          }),
        ]);
      } catch (err: unknown) {
        // P2002: concurrent round(40) — reportAd already created a row for
        // this (impressionId, userId) — re-read the winner and proceed
        // with the reversal (idempotent).
        if (err && typeof err === 'object' && (err as { code?: string }).code === 'P2002') {
          report = await this.prisma.adReport.findUniqueOrThrow({
            where: { impressionId_userId: { impressionId: impression.id, userId } },
          });
        } else {
          throw err;
        }
      }
    }
    // Always attempt the deterministic reversal. A reported-but-never-billed
    // impression has no forward ledger rows, making this a safe no-op. Paid
    // developer entries remain immutable
    // (matureEarnings already moved them past reversal) — those require a
    // separate claw-back flow documented in the ledger; the surface here
    // reports `paidSkipped` so the caller/operator knows money already left.
    const result = await this.ledger.reverseEarnings(
      { impressionId: impression.id },
      `User-reported ad: ${dto.reason}`,
    );
    if (result.paidSkipped > 0) {
      this.logger.warn(
        `reportAd: ${result.paidSkipped} paid earnings entry(ies) for impression ${impression.id} could not be reversed (already paid out)`,
      );
    }
    // Audit log for ad report (security-relevant: impression invalidated)
    void this.audit.log({
      actorId: userId,
      actorRole: 'developer',
      action: 'report_ad',
      targetType: 'impression',
      targetId: impression.id,
      afterSnap: { reason: dto.reason, invalidated: true },
    });
    return report;
  }

  async rateLimitedAuditRejection(reason: string, deviceId: string, userId: string): Promise<void> {
    const dedupKey = `${reason}:${deviceId}`;
    if (this.recentAuditRejections.has(dedupKey)) return;
    this.recentAuditRejections.set(dedupKey, true);
    void this.audit.log({
      actorId: userId,
      actorRole: 'developer',
      action: 'device_signature_rejected',
      targetType: 'device',
      targetId: deviceId,
      afterSnap: { reason },
    });
  }

  // ── HMAC Signature Verification ──
  /** Verify an event payload signature using the device-specific secret.
   *
   *  Authentication policy:
   *    1. `deviceId` is REQUIRED. Null/missing device → reject (return false).
   *       No event is accepted from an anonymous (no-device) caller. Every
   *       event-recording path in this service resolves a real device row
   *       (the impression's or start-event's deviceId) before verifying, so
   *       a null deviceId here means a caller forgot to resolve the device —
   *       treat it as unauthorized rather than silently authenticating via
   *       the global fall-back key.
   *    2. If the device row has an `eventSecret`, ONLY that per-device secret
   *       is accepted. The global HMAC is rejected even on a device-secret
   *       mismatch — a known device secret must not be forgeable by the
   *       global fallback key.
   *    3. If the device row exists but has no `eventSecret` (a legacy row
   *       that pre-dates per-device secrets), reject and require device
   *       re-registration. The registration path can issue a one-time
   *       per-device secret to the authenticated same-user owner.
   *
   *  The permanent anonymous (no-device) global-key fallback was removed: a
   *  null deviceId previously authenticated via the shared global HMAC,
   *  which would let any party that learns the global key forge events with
   *  no device binding. Reject instead. */
  async verifyDeviceSignature(
    deviceId: string | null,
    payload: Record<string, unknown>,
    signature: string,
  ): Promise<boolean> {
    // No device → no authentication. Do not fall back to the global HMAC for
    // anonymous callers.
    if (!deviceId) {
      // Audit-log null-device attempts: a misconfigured client would hit this
      // path constantly (no-ops), but a forge / replay attempt by an attacker
      // who learned deviceIds but no secrets would also fail here. Sampling
      // keeps noise low while preserving the signal.
      // Rate-limited: at most 1 entry per 60s per (reason, deviceId) pair.
      await this.rateLimitedAuditRejection('null_device_id', 'null', 'anonymous');
      return false;
    }
    const device = await this.prisma.device.findUnique({
      where: { id: deviceId },
      select: { eventSecret: true, userId: true },
    });
    if (!device) {
      // Rate-limited: at most 1 entry per 60s per (reason, deviceId) pair.
      await this.rateLimitedAuditRejection('unknown_device', deviceId, 'anonymous');
      return false; // unknown device → reject
    }
    if (device.eventSecret) {
      const ok = verifySignature(payload, device.eventSecret, signature);
      if (!ok) {
        // A device with a known secret submitted an unverifiable signature —
        // either a stale secret (post-rotation, pre-issuance) or an active
        // forgery attempt. Rate-limited: at most 1 entry per 60s per pair.
        await this.rateLimitedAuditRejection('device_secret_mismatch', deviceId, device.userId);
      }
      return ok;
    }
    // Rate-limited: at most 1 entry per 60s per (reason, deviceId) pair.
    await this.rateLimitedAuditRejection('missing_device_secret', deviceId, device.userId);
    return false;
  }

  // ── Privacy Enforcement ──
  /** Reject any payload containing prohibited data fields */
  enforcePrivacy(payload: Record<string, unknown>): void {
    for (const field of PROHIBITED_DATA_FIELDS) {
      if (field in payload) {
        throw new ForbiddenException(`Prohibited field detected: ${field}. Privacy violation.`);
      }
    }
  }

  /** Typed wrapper around enforcePrivacy that avoids unsafe casts — spreads into a plain object */
  enforcePrivacyOn<T extends object>(dto: T): void {
    this.enforcePrivacy({ ...dto } as Record<string, unknown>);
  }

  getAdvertiserBalance(advertiserId: string, currency: string): Promise<bigint> {
    return getAdvertiserBalance(this.prisma, advertiserId, currency);
  }

  // ── Extension Version Enforcement ──
  /**
   * Reject registration if the tool integration requires a minimum version and
   * the client does not meet it. Missing versions are allowed (legacy/MVP
   * clients); once a version is supplied it must satisfy the configured
   * minimum. Tool integrations are managed in `ToolIntegration`.
   */
  async assertMinimumExtensionVersion(toolType: string, extensionVersion?: string) {
    const integration = await this.prisma.toolIntegration.findUnique({
      where: { slug: toolType },
    });
    if (!integration || !integration.minVersion) return;

    const required = integration.minVersion;
    const provided = extensionVersion?.trim();
    if (!provided) {
      throw new ForbiddenException(
        `Extension version is required for ${toolType}. Minimum supported version: ${required}.`,
      );
    }

    if (!this.isVersionAtLeast(provided, required)) {
      throw new ForbiddenException(
        `Extension version ${provided} for ${toolType} is below the minimum supported version ${required}. Please update and try again.`,
      );
    }
  }

  /**
   * Compare two dotted version strings (e.g. "1.2.3"). Returns true if
   * `provided` is greater than or equal to `required`. Non-numeric segments
   * and pre-release suffixes are ignored for simplicity.
   */
  isVersionAtLeast(provided: string, required: string): boolean {
    const parse = (v: string) =>
      v
        .split('.')
        .map((part) => parseInt(part.replace(/[^\d].*$/, ''), 10))
        .filter((n) => !Number.isNaN(n));
    const p = parse(provided);
    const r = parse(required);
    const maxLen = Math.max(p.length, r.length);
    for (let i = 0; i < maxLen; i++) {
      const a = p[i] ?? 0;
      const b = r[i] ?? 0;
      if (a > b) return true;
      if (a < b) return false;
    }
    return true;
  }
}
