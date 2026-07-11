import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';

import { ToolTypeEnum } from '@waitlayer/db';

import { PrismaService } from '../config/prisma.service';
import {
  WAIT_STATE_DURATION_TOLERANCE_SECONDS,
  WAIT_STATE_MAX_DURATION_SECONDS,
} from './extension.constants';
import { ExtensionDeviceReportTrait } from './extension-device-report.trait';

export class ExtensionWaitTrait {
  declare prisma: PrismaService;

  // ── Wait State Events ──
  async recordWaitStateStart(
    userId: string,
    dto: {
      deviceId: string;
      sessionId: string;
      toolType: string;
      waitStateId: string;
      idempotencyKey: string;
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
    // Idempotency: only return an existing event after ownership/signature pass.
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
    return this.prisma.waitStateEvent.create({
      data: {
        userId,
        deviceId: dto.deviceId,
        sessionId: dto.sessionId,
        eventType: 'wait_state_start',
        waitStateId: dto.waitStateId,
        toolType: dto.toolType as ToolTypeEnum,
        signature: dto.signature,
        idempotencyKey: dto.idempotencyKey,
      },
    });
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
      typeof dto.durationSeconds === 'string'
        ? parseInt(dto.durationSeconds, 10)
        : dto.durationSeconds;
    if (
      Number.isNaN(claimedDurationSeconds) ||
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
      },
    });
  }
}
export interface ExtensionWaitTrait extends ExtensionDeviceReportTrait {}
