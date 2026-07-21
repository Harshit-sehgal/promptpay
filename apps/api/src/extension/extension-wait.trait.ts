import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';

import { Prisma, ToolTypeEnum } from '@waitlayer/db';
import { DetectorEvidence, verifyEvidence } from '@waitlayer/shared';

import { PrismaService } from '../config/prisma.service';
import { FraudService } from '../fraud/fraud.service';
import { AlertsService } from '../observability/alerts.service';
import type { RuntimeConfigService } from '../runtime-config/runtime-config.service';
import {
  classifyWaitState,
  computeWaitConfidence,
  isVerifiedDetectorSource,
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
export { classifyWaitState, computeWaitConfidence, MINIMUM_WAIT_CONFIDENCE, SIGNAL_WEIGHTS };
export type { WaitSignal };

// P1.25 alert spike tuning: how many false-positive reports within the trailing
// window count as a "spike" (detector precision regression) worth alerting on.
const FP_SPIKE_WINDOW_MS = 15 * 60 * 1000; // 15 minutes
const FP_SPIKE_THRESHOLD = 5;

export class ExtensionWaitTrait {
  declare prisma: PrismaService;
  declare alerts?: AlertsService;
  declare fraud: FraudService;
  declare runtimeConfig: RuntimeConfigService;

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
      evidence?: DetectorEvidence[];
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
    // Verify per-item evidence signatures if evidence is supplied. Evidence is
    // signed with the device secret, so a modified client cannot inject fake
    // corroboration without access to the per-device HMAC key.
    if (dto.evidence && dto.evidence.length > 0) {
      const deviceSecret = device.eventSecret;
      if (!deviceSecret) {
        throw new ForbiddenException('Device has no event secret; cannot verify evidence');
      }
      // P0.2: Known adapter allowlist — reject evidence from unknown adapters.
      const KNOWN_ADAPTERS = new Set([
        'vscode.task',
        'vscode.terminal',
        'vscode.heuristic',
        'cli.runner.command',
        'cli.runner.task',
        // 'cli.runner.market' intentionally removed — no client produces this
        // adapter ID. The 'cli.runner.' prefix below already covers future
        // cli.runner.* adapters without an explicit entry.
      ]);
      // Adapter prefix allowlist for dynamic adapter IDs (e.g. vscode.ai-tool.*, vscode.heuristic.*).
      // Test adapters (test.*) are included so the evidence test helper can produce
      // valid evidence items without being blocked by the production allowlist.
      const KNOWN_ADAPTER_PREFIXES = [
        'vscode.ai-tool.',
        'vscode.heuristic.',
        'cli.runner.',
        'test.',
      ];
      // P0.2: Evidence freshness — reject evidence older than 60 seconds.
      const now = Date.now();
      const MAX_EVIDENCE_AGE_MS = 60_000;
      for (const item of dto.evidence) {
        // Adapter allowlist check
        const isKnown =
          KNOWN_ADAPTERS.has(item.adapterId) ||
          KNOWN_ADAPTER_PREFIXES.some((prefix) => item.adapterId.startsWith(prefix));
        if (!isKnown) {
          throw new BadRequestException(
            `Unknown evidence adapter: ${item.adapterId}; this evidence item is rejected`,
          );
        }
        // Wait state + session binding check
        if (item.waitStateId !== dto.waitStateId || item.sessionId !== dto.sessionId) {
          throw new ForbiddenException('Evidence does not belong to this wait state');
        }
        // Evidence freshness check — reject stale evidence within a bounded window.
        if (
          item.timestamp &&
          (now - item.timestamp > MAX_EVIDENCE_AGE_MS || item.timestamp > now + 5_000)
        ) {
          throw new BadRequestException(
            `Evidence timestamp is outside the acceptable window (max ${MAX_EVIDENCE_AGE_MS}ms old, max 5s in future)`,
          );
        }
        // Detector version consistency check
        if (
          dto.detectorVersion &&
          item.detectorVersion &&
          item.detectorVersion !== dto.detectorVersion
        ) {
          throw new BadRequestException(
            `Evidence detector version (${item.detectorVersion}) does not match request detector version (${dto.detectorVersion})`,
          );
        }
        // Signature verification
        if (!verifyEvidence(item, deviceSecret)) {
          throw new ForbiddenException('Invalid evidence signature');
        }
      }
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
    const detectorAllowlist = this.runtimeConfig.getVerifiedDetectorVersions();
    const classification = classifyWaitState(
      dto.signals ?? [],
      isVerifiedDetectorSource(dto.detectorVersion, detectorAllowlist),
      dto.evidence,
    );
    // Persist only the signal categories, never the optional human-readable
    // details, so user code/PII never reaches the database.
    const sanitizedSignals = (dto.signals ?? []).map(({ type }) => ({ type }));
    // Persist the verified evidence payload. Signatures are not secret, and
    // retaining them lets the server re-verify evidence later.
    const sanitizedEvidence = dto.evidence;
    // Server-side behavioural verification: flag anomalous wait-state patterns
    // (e.g. repeated identical single-signal submissions) for review. This is
    // best-effort and non-blocking so a transient anomaly cannot break the
    // event-recording path.
    void this.checkAnomalousWaitState?.(userId, dto.deviceId, dto.signals ?? []).catch(
      () => undefined,
    );
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
          evidence: sanitizedEvidence as unknown as Prisma.InputJsonValue,
          confidence: classification.confidence,
          reason: classification.reason,
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
   * Best-effort behavioural verification. Delegates to FraudService to
   * detect modified clients that submit repeated, invariant signal patterns
   * (e.g. the same single `ai_generation` signal with identical timing).
   * This call is intentionally non-blocking: a failure here must not prevent
   * legitimate wait-state recording.
   */
  async checkAnomalousWaitState(
    userId: string,
    deviceId: string,
    signals: WaitSignal[],
  ): Promise<void> {
    if (!this.fraud) return;
    await this.fraud.checkAnomalousWaitSignals(userId, deviceId, signals);
  }

  /**
   * Flag a wait state as a false positive. Used by developers (or an admin
   * on their behalf) to improve the detector. The flag is stored on the
   * start event and is used by analytics/evaluation to compute precision.
   *
   * P1 #16: the normalized reason, optional note, and report timestamp are
   * persisted alongside the flag (previously the reason was discarded).
   * Repeated reports are IDEMPOTENT — only the first report's feedback is
   * stored; later calls return the current row unchanged (and still feed the
   * spike detector, so feedback spam stays visible without corrupting data).
   */
  async flagFalsePositive(
    userId: string,
    waitStateId: string,
    feedback?: { reason?: string; note?: string },
  ) {
    const start = await this.prisma.waitStateEvent.findFirst({
      where: { userId, waitStateId, eventType: 'wait_state_start' },
      orderBy: { createdAt: 'desc' },
    });
    if (!start) throw new NotFoundException('Wait state not found');
    if (start.userId !== userId) {
      throw new ForbiddenException('You do not own this wait state');
    }
    // Idempotency: never overwrite the first report's feedback. Also gate
    // the alert spike counter so repeated calls for the same wait state do
    // not artificially inflate the regression signal.
    if (start.isFalsePositive) {
      return start;
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
      data: {
        isFalsePositive: true,
        falsePositiveReason: feedback?.reason ?? null,
        falsePositiveNote: feedback?.note ?? null,
        falsePositiveReportedAt: new Date(),
      },
    });
  }
}
export interface ExtensionWaitTrait extends ExtensionDeviceReportTrait {}
