import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';

import { Prisma, ToolTypeEnum } from '@waitlayer/db';

import { PrismaService } from '../config/prisma.service';
import { AlertsService } from '../observability/alerts.service';
import {
  computeWaitConfidence,
  MINIMUM_WAIT_CONFIDENCE,
  SIGNAL_WEIGHTS,
  WAIT_STATE_DURATION_TOLERANCE_SECONDS,
  WAIT_STATE_MAX_DURATION_SECONDS,
  WaitSignal,
} from './extension.constants';
import { ExtensionDeviceReportTrait } from './extension-device-report.trait';

// Re-export for backward compatibility — existing import sites that reference
// these from extension-wait.trait.ts continue to work. The canonical home is
// now extension.constants.ts, which has no class/trait dependencies, so
// modules like the health controller can import MINIMUM_WAIT_CONFIDENCE
// without pulling in the trait class and its transitive NestJS/Prisma deps.
export { computeWaitConfidence, MINIMUM_WAIT_CONFIDENCE, SIGNAL_WEIGHTS };
export type { WaitSignal };

// P1.25 alert spike tuning: how many false-positive reports within the trailing
// window count as a "spike" (detector precision regression) worth alerting on.
const FP_SPIKE_WINDOW_MS = 15 * 60 * 1000; // 15 minutes
const FP_SPIKE_THRESHOLD = 5;

export class ExtensionWaitTrait {
  declare prisma: PrismaService;
  declare alerts?: AlertsService;

  // ── Wait State Events ──
  async recordWaitStateStart(
    userId: string,
    dto: {
      deviceId: string;
      sessionId: string;
      toolType: string;
      waitStateId: string;
      idempotencyKey: string;
      signals?: WaitSignal[];
      detectorVersion?: string;
      signature: string;
    },
  ) {
    this.enforcePrivacyOn(dto);
    // Verify device belongs to this user
    const device = await this.prisma.device.findUnique({ where: { id: dto.deviceId } });
    if (!device || device.userId !== userId) {
      throw new ForbiddenException('Device does not belong to this user');
    }
    // Verify HMAC signature with device-specific secret
    const { signature: _, ...payload } = dto;
    if (!(await this.verifyDeviceSignature(dto.deviceId, payload, dto.signature))) {
      throw new ForbiddenException('Invalid request signature');
    }
    // P1.17: detector-version kill-switch. A disabled detector version must
    // not record billable wait states, so operators can roll back a bad
    // wait-detector release without an extension update.
    if (!(await this.runtimeConfig.isDetectorVersionEnabled(dto.detectorVersion))) {
      throw new ForbiddenException(
        `Detector version "${dto.detectorVersion}" is currently disabled`,
      );
    }
    // Idempotency ordering (P1 #20): locate the idempotency key FIRST — only
    // after ownership/signature pass — so an exact retry returns the original
    // row instead of a spurious 409 from the duplicate-waitStateId guard.
    const existing = await this.prisma.waitStateEvent.findUnique({
      where: { idempotencyKey: dto.idempotencyKey },
    });
    if (existing) {
      if (
        existing.userId !== userId ||
        existing.deviceId !== dto.deviceId ||
        existing.waitStateId !== dto.waitStateId ||
        existing.eventType !== 'wait_state_start'
      ) {
        throw new ConflictException('Idempotency key already used');
      }
      return existing;
    }
    // Reject a waitStateId reused under a DIFFERENT key — a
    // @@unique([waitStateId, eventType]) guards at the DB layer (migration
    // 20260718025000), but give the client a clean 409 rather than a raw
    // P2002 constraint violation.
    const duplicateStart = await this.prisma.waitStateEvent.findFirst({
      where: { waitStateId: dto.waitStateId, eventType: 'wait_state_start' },
    });
    if (duplicateStart) {
      // A concurrent exact retry may have committed BETWEEN our key lookup
      // above and this check. If the existing start carries THIS request's
      // key and payload identity, it is the same logical request — return
      // the winner instead of a spurious 409.
      if (
        duplicateStart.idempotencyKey === dto.idempotencyKey &&
        duplicateStart.userId === userId &&
        duplicateStart.deviceId === dto.deviceId
      ) {
        return duplicateStart;
      }
      throw new ConflictException('A wait_state_start event already exists for this waitStateId.');
    }
    const { confidence, reason } = computeWaitConfidence(dto.signals ?? []);
    // Persist only the signal categories, never the optional human-readable
    // details, so user code/PII never reaches the database.
    const sanitizedSignals = (dto.signals ?? []).map(({ type }) => ({ type }));
    try {
      return await this.prisma.waitStateEvent.create({
        data: {
          userId,
          deviceId: dto.deviceId,
          sessionId: dto.sessionId,
          eventType: 'wait_state_start',
          waitStateId: dto.waitStateId,
          toolType: dto.toolType as ToolTypeEnum,
          signature: dto.signature,
          idempotencyKey: dto.idempotencyKey,
          signals: sanitizedSignals as unknown as Prisma.InputJsonValue,
          confidence,
          reason,
          detectorVersion: dto.detectorVersion,
        },
      });
    } catch (error) {
      // Unique-race handling: a concurrent request committed between our
      // checks and the insert. If it carried the SAME idempotency key and
      // payload identity, it is a concurrent exact retry — return the winner.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const winner = await this.prisma.waitStateEvent.findUnique({
          where: { idempotencyKey: dto.idempotencyKey },
        });
        if (
          winner &&
          winner.userId === userId &&
          winner.deviceId === dto.deviceId &&
          winner.waitStateId === dto.waitStateId &&
          winner.eventType === 'wait_state_start'
        ) {
          return winner;
        }
        throw new ConflictException(
          'A wait_state_start event already exists for this waitStateId.',
        );
      }
      throw error;
    }
  }

  async recordWaitStateEnd(
    userId: string,
    dto: {
      waitStateId: string;
      durationSeconds: string | number;
      idempotencyKey: string;
      signature: string;
    },
  ) {
    this.enforcePrivacyOn(dto);
    // Resolve the start event FIRST so we can verify with the device's secret
    const start = await this.prisma.waitStateEvent.findFirst({
      where: { userId, waitStateId: dto.waitStateId, eventType: 'wait_state_start' },
      orderBy: { createdAt: 'desc' },
    });
    if (!start) throw new BadRequestException('No matching wait state start');
    if (start.userId !== userId) {
      throw new ForbiddenException('You do not own this wait state');
    }
    // Verify HMAC signature with device-specific secret
    const { signature: _, ...payload } = dto;
    if (!(await this.verifyDeviceSignature(start.deviceId, payload, dto.signature))) {
      throw new ForbiddenException('Invalid request signature');
    }
    // Idempotency: only return an existing event after ownership/signature pass.
    const existing = await this.prisma.waitStateEvent.findUnique({
      where: { idempotencyKey: dto.idempotencyKey },
    });
    if (existing) {
      if (
        existing.userId !== userId ||
        existing.waitStateId !== dto.waitStateId ||
        existing.eventType !== 'wait_state_end'
      ) {
        throw new ConflictException('Idempotency key already used');
      }
      return existing;
    }
    const claimedDurationSeconds =
      typeof dto.durationSeconds === 'string' ? Number(dto.durationSeconds) : dto.durationSeconds;
    if (
      !Number.isInteger(claimedDurationSeconds) ||
      claimedDurationSeconds < 0 ||
      claimedDurationSeconds > WAIT_STATE_MAX_DURATION_SECONDS
    ) {
      throw new BadRequestException('Invalid duration value');
    }
    // Server-compute the duration from the start event's createdAt to now.
    // The client-claimed duration is allowed only within a small
    // tolerance window — this blocks attempts to extend
    // earnings-credit-eligible time on a session that actually ended long
    // ago, while still tolerating clock skew and event-delivery latency on
    // the extension side. The stored duration is the server-computed value
    // — the claimed value is only used for the consistency check.
    const serverDuration = Math.floor((Date.now() - start.createdAt.getTime()) / 1000);
    const drift = Math.abs(serverDuration - claimedDurationSeconds);
    if (drift > WAIT_STATE_DURATION_TOLERANCE_SECONDS) {
      throw new BadRequestException(
        `Duration mismatch (claimed=${claimedDurationSeconds}s, server=${serverDuration}s, tolerance=${WAIT_STATE_DURATION_TOLERANCE_SECONDS}s)`,
      );
    }
    const duration = serverDuration;
    return this.prisma.waitStateEvent.create({
      data: {
        userId: start.userId,
        deviceId: start.deviceId,
        sessionId: start.sessionId,
        eventType: 'wait_state_end',
        waitStateId: dto.waitStateId,
        toolType: start.toolType,
        duration,
        signature: dto.signature,
        idempotencyKey: dto.idempotencyKey,
        // Mirror detection metadata from the start event so analytics and
        // billing guards can inspect the end event without joining the start.
        confidence: start.confidence,
        reason: start.reason,
        detectorVersion: start.detectorVersion,
      },
    });
  }

  /**
   * Flag a wait state as a false positive. Used by developers (or an admin
   * on their behalf) to improve the detector. The flag is stored on the
   * start event and is used by analytics/evaluation to compute precision.
   */
  async flagFalsePositive(userId: string, waitStateId: string) {
    const start = await this.prisma.waitStateEvent.findFirst({
      where: { userId, waitStateId, eventType: 'wait_state_start' },
      orderBy: { createdAt: 'desc' },
    });
    if (!start) throw new NotFoundException('Wait state not found');
    if (start.userId !== userId) {
      throw new ForbiddenException('You do not own this wait state');
    }
    // P1.25: alert on a burst of false-positive reports (detector precision
    // regression) rather than every single one.
    const burst =
      this.alerts?.recordRate('wait_false_positive_spike', 'global', FP_SPIKE_WINDOW_MS) ?? 0;
    if (burst >= FP_SPIKE_THRESHOLD) {
      this.alerts?.sendAlert('wait_false_positive_spike', 'global', { windowCount: burst });
    }
    return this.prisma.waitStateEvent.update({
      where: { id: start.id },
      data: { isFalsePositive: true },
    });
  }
}
export interface ExtensionWaitTrait extends ExtensionDeviceReportTrait {}
