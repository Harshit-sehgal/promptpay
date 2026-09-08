import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';

import { PrismaService } from '../config/prisma.service';

export type AttentionShadowAdminSnapshot = {
  generatedAt: string;
  facts: {
    total: number;
    unverified: number;
    verified: number;
    unknownRisk: number;
  };
  policies: readonly {
    version: number;
    status: string;
    effectiveAt: string;
    retiredAt: string | null;
  }[];
  models: readonly {
    modelId: string;
    modelVersion: string;
    modelFamily: string;
    status: string;
    artifactDigest: string;
  }[];
  experiments: readonly {
    experimentId: string;
    status: string;
    assignmentUnit: string | null;
    assignmentCount: number;
    outcomeCount: number;
  }[];
  financialSideEffects: false;
};

/** Read-only shadow observability plus explicit operator freeze controls. */
@Injectable()
export class AttentionShadowAdminService {
  constructor(private readonly prisma: PrismaService) {}

  async snapshot(): Promise<AttentionShadowAdminSnapshot> {
    const [facts, unverified, verified, unknownRisk, policies, models, experiments] =
      await Promise.all([
        this.prisma.attentionSessionFact.count(),
        this.prisma.attentionSessionFact.count({ where: { attestationStatus: 'unverified' } }),
        this.prisma.attentionSessionFact.count({ where: { attestationStatus: 'verified' } }),
        this.prisma.attentionSessionFact.count({ where: { fraudRiskStatus: 'unknown' } }),
        this.prisma.attentionPricingPolicy.findMany({
          orderBy: { version: 'desc' },
          select: { version: true, status: true, effectiveAt: true, retiredAt: true },
        }),
        this.prisma.attentionModelArtifact.findMany({
          orderBy: { trainedAt: 'desc' },
          select: {
            modelId: true,
            modelVersion: true,
            modelFamily: true,
            status: true,
            artifactDigest: true,
          },
        }),
        this.prisma.attentionExperiment.findMany({
          orderBy: { createdAt: 'desc' },
          select: {
            id: true,
            status: true,
            assignmentUnit: true,
            _count: { select: { assignments: true, outcomes: true } },
          },
        }),
      ]);

    return {
      generatedAt: new Date().toISOString(),
      facts: { total: facts, unverified, verified, unknownRisk },
      policies: policies.map((policy) => ({
        version: policy.version,
        status: policy.status,
        effectiveAt: policy.effectiveAt.toISOString(),
        retiredAt: policy.retiredAt?.toISOString() ?? null,
      })),
      models: models.map((model) => ({
        modelId: model.modelId,
        modelVersion: model.modelVersion,
        modelFamily: model.modelFamily,
        status: model.status,
        artifactDigest: model.artifactDigest,
      })),
      experiments: experiments.map((experiment) => ({
        experimentId: experiment.id,
        status: experiment.status,
        assignmentUnit: experiment.assignmentUnit,
        assignmentCount: experiment._count.assignments,
        outcomeCount: experiment._count.outcomes,
      })),
      financialSideEffects: false,
    };
  }

  async freezePolicy(version: number, operatorId: string, reason?: string) {
    assertOperatorReason(operatorId, reason);
    const policy = await this.prisma.attentionPricingPolicy.findUnique({
      where: { version },
      select: { id: true, version: true, status: true },
    });
    if (!policy) throw new NotFoundException('Attention policy was not found');
    if (policy.status === 'active' || policy.status === 'canary') {
      throw new ConflictException('Live/canary attention policies require the Wave 6 release gate');
    }
    if (policy.status === 'revoked') {
      return { status: 'already_frozen' as const, version, financialSideEffects: false as const };
    }
    if (!['draft', 'shadow', 'experiment'].includes(policy.status)) {
      throw new ConflictException('Only draft, shadow, and experiment policies may be frozen here');
    }
    await this.prisma.attentionPricingPolicy.update({
      where: { id: policy.id },
      data: { status: 'revoked', retiredAt: new Date() },
    });
    return { status: 'frozen' as const, version, financialSideEffects: false as const };
  }

  async freezeModel(modelId: string, modelVersion: string, operatorId: string, reason?: string) {
    assertOperatorReason(operatorId, reason);
    const model = await this.prisma.attentionModelArtifact.findUnique({
      where: { modelId_modelVersion: { modelId, modelVersion } },
      select: { id: true, status: true },
    });
    if (!model) throw new NotFoundException('Attention model was not found');
    if (model.status === 'approved') {
      throw new ConflictException('Approved model changes require the model promotion gate');
    }
    if (model.status === 'revoked') {
      return {
        status: 'already_frozen' as const,
        modelId,
        modelVersion,
        financialSideEffects: false as const,
      };
    }
    if (!['candidate', 'shadow'].includes(model.status)) {
      throw new ConflictException('Only candidate and shadow models may be frozen here');
    }
    await this.prisma.attentionModelArtifact.update({
      where: { id: model.id },
      data: { status: 'revoked' },
    });
    return {
      status: 'frozen' as const,
      modelId,
      modelVersion,
      financialSideEffects: false as const,
    };
  }
}

function assertOperatorReason(operatorId: string, reason?: string): void {
  if (!operatorId) throw new Error('operatorId is required');
  if (reason !== undefined && (reason.length === 0 || reason.length > 500)) {
    throw new Error('freeze reason must be bounded when supplied');
  }
}
