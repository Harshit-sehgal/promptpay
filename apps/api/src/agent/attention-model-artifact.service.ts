import { ConflictException, Injectable } from '@nestjs/common';

import { type AttentionModelArtifact, attentionModelArtifactSchema } from '@ateva/agent-protocol';
import { Prisma } from '@ateva/db';

import { PrismaService } from '../config/prisma.service';
import {
  type InterpretableResponseModel,
  MODEL_PARAMETER_VERSION,
  responseModelArtifactDigest,
  type TrainedResponseModel,
} from './attention-response-model';

export type PersistedModelArtifactResult = {
  status: 'created' | 'duplicate';
  modelId: string;
  modelVersion: string;
  artifactDigest: string;
  financialSideEffects: false;
};

/** Persist model metadata and coefficients, never training rows or outcomes. */
@Injectable()
export class AttentionModelArtifactService {
  constructor(private readonly prisma: PrismaService) {}

  async persist(result: TrainedResponseModel): Promise<PersistedModelArtifactResult> {
    const artifact = attentionModelArtifactSchema.parse(result.artifact);
    if (
      result.model.modelId !== artifact.modelId ||
      result.model.modelVersion !== artifact.modelVersion ||
      result.model.modelFamily !== artifact.modelFamily ||
      result.model.datasetDigest !== artifact.datasetDigest ||
      result.datasetManifest.digest !== artifact.datasetDigest ||
      result.model.featureNames.length !== artifact.featureNames.length ||
      result.model.featureNames.some((name, index) => name !== artifact.featureNames[index])
    ) {
      throw new Error('model and artifact metadata do not agree');
    }
    const { artifactDigest: _ignored, ...artifactWithoutDigest } = artifact;
    if (
      responseModelArtifactDigest(artifactWithoutDigest, result.model) !== artifact.artifactDigest
    ) {
      throw new ConflictException('artifactDigest does not match model and metadata content');
    }
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.attentionModelArtifact.findUnique({
        where: {
          modelId_modelVersion: {
            modelId: artifact.modelId,
            modelVersion: artifact.modelVersion,
          },
        },
        select: { artifactDigest: true },
      });
      if (existing) {
        if (existing.artifactDigest !== artifact.artifactDigest) {
          throw new ConflictException('Model version already exists with a different digest');
        }
        return {
          status: 'duplicate',
          modelId: artifact.modelId,
          modelVersion: artifact.modelVersion,
          artifactDigest: existing.artifactDigest,
          financialSideEffects: false,
        };
      }

      await tx.attentionModelArtifact.create({
        data: toDatabaseArtifact(artifact, result.model),
      });
      return {
        status: 'created',
        modelId: artifact.modelId,
        modelVersion: artifact.modelVersion,
        artifactDigest: artifact.artifactDigest,
        financialSideEffects: false,
      };
    });
  }
}

function toDatabaseArtifact(
  artifact: AttentionModelArtifact,
  model: InterpretableResponseModel,
): {
  modelId: string;
  modelVersion: string;
  modelFamily: AttentionModelArtifact['modelFamily'];
  datasetDigest: string;
  featureNames: string[];
  trainWindowStart: Date;
  trainWindowEnd: Date;
  validationStart: Date;
  validationEnd: Date;
  testWindowStart: Date;
  testWindowEnd: Date;
  trainedAt: Date;
  artifactDigest: string;
  status: AttentionModelArtifact['status'];
  modelParameters: Prisma.InputJsonValue;
  calibration: Prisma.InputJsonValue;
  uncertainty: Prisma.InputJsonValue;
  rollbackModelVersion: string | null;
} {
  return {
    modelId: artifact.modelId,
    modelVersion: artifact.modelVersion,
    modelFamily: artifact.modelFamily,
    datasetDigest: artifact.datasetDigest,
    featureNames: [...artifact.featureNames],
    trainWindowStart: new Date(artifact.trainWindow.start),
    trainWindowEnd: new Date(artifact.trainWindow.end),
    validationStart: new Date(artifact.validationWindow.start),
    validationEnd: new Date(artifact.validationWindow.end),
    testWindowStart: new Date(artifact.testWindow.start),
    testWindowEnd: new Date(artifact.testWindow.end),
    trainedAt: new Date(artifact.trainedAt),
    artifactDigest: artifact.artifactDigest,
    status: artifact.status,
    modelParameters: {
      parameterVersion: MODEL_PARAMETER_VERSION,
      link: model.link,
      featureScales: model.featureScales,
      coefficients: model.coefficients,
      intercept: model.intercept,
    },
    calibration: artifact.calibration,
    uncertainty: artifact.uncertainty,
    rollbackModelVersion: artifact.rollback.previousModelVersion,
  } as {
    modelId: string;
    modelVersion: string;
    modelFamily: AttentionModelArtifact['modelFamily'];
    datasetDigest: string;
    featureNames: string[];
    trainWindowStart: Date;
    trainWindowEnd: Date;
    validationStart: Date;
    validationEnd: Date;
    testWindowStart: Date;
    testWindowEnd: Date;
    trainedAt: Date;
    artifactDigest: string;
    status: AttentionModelArtifact['status'];
    modelParameters: Prisma.InputJsonValue;
    calibration: Prisma.InputJsonValue;
    uncertainty: Prisma.InputJsonValue;
    rollbackModelVersion: string | null;
  };
}
