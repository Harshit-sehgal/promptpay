import { ConflictException, Injectable } from '@nestjs/common';

import { type ShadowSessionFact, shadowSessionFactSchema } from '@ateva/agent-protocol';

import { PrismaService } from '../config/prisma.service';
import { shadowSessionFactDigest } from './attention-shadow-facts';

export type PersistedShadowFactResult = {
  status: 'created' | 'duplicate';
  sessionId: string;
  recordDigest: string;
  financialSideEffects: false;
};

/**
 * Persists only an already-validated immutable shadow fact. The service has no
 * dependency on campaign, impression, ledger, payout, or settlement models.
 * A same-session replay is accepted only when its content digest matches;
 * conflicting facts fail closed instead of being overwritten.
 */
@Injectable()
export class AttentionShadowFactService {
  constructor(private readonly prisma: PrismaService) {}

  async persist(
    sessionId: string,
    inputFact: ShadowSessionFact,
  ): Promise<PersistedShadowFactResult> {
    if (!sessionId) throw new Error('sessionId is required');
    const fact = shadowSessionFactSchema.parse(inputFact);
    if (shadowSessionFactDigest(fact) !== fact.recordDigest) {
      throw new ConflictException('Shadow fact recordDigest does not match its content');
    }

    return this.prisma.$transaction(async (tx) => {
      const assignment = await tx.attentionSessionPolicyAssignment.findUnique({
        where: { sessionId },
        select: { policy: { select: { version: true } } },
      });
      if (!assignment) {
        throw new ConflictException('Shadow fact requires an immutable session policy assignment');
      }
      if (assignment.policy.version !== fact.policyVersion) {
        throw new ConflictException(
          'Shadow fact policy version does not match the session assignment',
        );
      }
      const existing = await tx.attentionSessionFact.findUnique({
        where: { sessionId },
        select: { recordDigest: true },
      });
      if (existing) {
        if (existing.recordDigest !== fact.recordDigest) {
          throw new ConflictException('Shadow fact already exists with a different digest');
        }
        return {
          status: 'duplicate',
          sessionId,
          recordDigest: existing.recordDigest,
          financialSideEffects: false,
        };
      }

      await tx.attentionSessionFact.create({
        data: {
          sessionId,
          datasetVersion: fact.datasetVersion,
          sessionKey: fact.sessionKey,
          userKey: fact.userKey,
          deviceKey: fact.deviceKey,
          observedAt: new Date(fact.observedAt),
          sessionStartedAt: new Date(fact.sessionStartedAt),
          sessionEndedAt: new Date(fact.sessionEndedAt),
          environmentKind: fact.environmentKind,
          environmentId: fact.environmentId,
          providerClass: fact.providerClass,
          integrationMode: fact.integrationMode,
          toolClass: fact.toolClass,
          policyVersion: fact.policyVersion,
          alphaPpm: fact.alphaPpm,
          passiveCapRatioPpm: fact.passiveCapRatioPpm,
          passiveSessionCapMs: fact.passiveSessionCapMs,
          minimumQualifiedMs: fact.minimumQualifiedMs,
          renderedMs: fact.renderedMs,
          viewableMs: fact.viewableMs,
          aiEligibleMs: fact.aiEligibleMs,
          qualifiedMs: fact.qualifiedMs,
          passiveMs: fact.passiveMs,
          passiveBillableMs: fact.passiveBillableMs,
          weightedBillablePpmMs: fact.weightedBillablePpmMs,
          attestationStatus: fact.attestationStatus,
          classificationConfidencePpm: fact.classificationConfidencePpm,
          fraudRiskStatus: fact.fraudRiskStatus,
          unknownEventRatePpm: fact.unknownEventRatePpm,
          hypotheticalCurrency: fact.hypotheticalCurrency,
          hypotheticalAdvertiserChargeMinor: fact.hypotheticalAdvertiserChargeMinor,
          hypotheticalUserRewardMinor: fact.hypotheticalUserRewardMinor,
          hypotheticalPlatformContributionMinor: fact.hypotheticalPlatformContributionMinor,
          economicCalculationVersion: fact.economicCalculationVersion,
          calculationVersion: fact.calculationVersion,
          recordDigest: fact.recordDigest,
          recordedAt: new Date(fact.recordedAt),
        },
      });

      return {
        status: 'created',
        sessionId,
        recordDigest: fact.recordDigest,
        financialSideEffects: false,
      };
    });
  }
}
