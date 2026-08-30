import { Injectable } from '@nestjs/common';

import type { AttentionDatasetManifest, ShadowSessionFact } from '@ateva/agent-protocol';

import { PrismaService } from '../config/prisma.service';
import {
  buildAttentionDatasetManifest,
  type ModelFeatureName,
  type ModelObservation,
  observationFromShadowFact,
  type TemporalWindow,
} from './attention-response-model';

type StoredShadowFactRow = Pick<
  ShadowSessionFact,
  | 'sessionKey'
  | 'providerClass'
  | 'integrationMode'
  | 'environmentKind'
  | 'renderedMs'
  | 'viewableMs'
  | 'aiEligibleMs'
  | 'qualifiedMs'
  | 'passiveMs'
  | 'passiveBillableMs'
  | 'weightedBillablePpmMs'
  | 'policyVersion'
  | 'alphaPpm'
  | 'passiveCapRatioPpm'
  | 'passiveSessionCapMs'
  | 'minimumQualifiedMs'
  | 'classificationConfidencePpm'
  | 'unknownEventRatePpm'
> & {
  observedAt: Date;
};

const SHADOW_FACT_SELECT = {
  sessionKey: true,
  observedAt: true,
  environmentKind: true,
  providerClass: true,
  integrationMode: true,
  policyVersion: true,
  alphaPpm: true,
  passiveCapRatioPpm: true,
  passiveSessionCapMs: true,
  minimumQualifiedMs: true,
  renderedMs: true,
  viewableMs: true,
  aiEligibleMs: true,
  qualifiedMs: true,
  passiveMs: true,
  passiveBillableMs: true,
  weightedBillablePpmMs: true,
  classificationConfidencePpm: true,
  unknownEventRatePpm: true,
} as const;

export type ShadowFactDatasetRequest = {
  datasetId: string;
  datasetVersion: number;
  sourceWindow: TemporalWindow;
  featureNames: readonly ModelFeatureName[];
  /** The caller chooses the metric and supplies only trusted, observed labels. */
  outcomeName: string;
  outcomeBySessionKey: ReadonlyMap<string, number>;
  generatedAt: string;
};

export type ShadowFactDatasetResult = {
  manifest: AttentionDatasetManifest;
  observations: readonly ModelObservation[];
  scanned: number;
  included: number;
  skippedWithoutOutcome: number;
  financialSideEffects: false;
};

/**
 * Reads persisted shadow facts into the existing model contracts.
 *
 * This service deliberately does not invent labels: facts without an explicit
 * outcome supplied by the caller are excluded from the model-ready rows. It
 * selects only the allowlisted aggregate fields and performs no writes.
 */
@Injectable()
export class AttentionShadowDatasetService {
  constructor(private readonly prisma: PrismaService) {}

  async read(input: ShadowFactDatasetRequest): Promise<ShadowFactDatasetResult> {
    const { start, end } = parseWindow(input.sourceWindow);
    const rows = (await this.prisma.attentionSessionFact.findMany({
      where: {
        observedAt: {
          gte: start,
          lt: end,
        },
      },
      orderBy: [{ observedAt: 'asc' }, { id: 'asc' }],
      select: SHADOW_FACT_SELECT,
    })) as StoredShadowFactRow[];

    const observations: ModelObservation[] = [];
    let skippedWithoutOutcome = 0;
    const orderedRows = [...rows].sort(
      (left, right) =>
        left.observedAt.getTime() - right.observedAt.getTime() ||
        left.sessionKey.localeCompare(right.sessionKey),
    );
    for (const row of orderedRows) {
      const outcome = input.outcomeBySessionKey.get(row.sessionKey);
      if (outcome === undefined) {
        skippedWithoutOutcome++;
        continue;
      }
      observations.push(observationFromShadowFact(toModelFact(row), outcome, input.featureNames));
    }

    const manifest = buildAttentionDatasetManifest({
      datasetId: input.datasetId,
      datasetVersion: input.datasetVersion,
      sourceWindow: input.sourceWindow,
      featureNames: input.featureNames,
      outcomeNames: [input.outcomeName],
      observations,
      generatedAt: input.generatedAt,
      source: 'telemetry',
    });

    return {
      manifest,
      observations,
      scanned: rows.length,
      included: observations.length,
      skippedWithoutOutcome,
      financialSideEffects: false,
    };
  }
}

function toModelFact(
  row: StoredShadowFactRow,
): Pick<
  ShadowSessionFact,
  | 'sessionKey'
  | 'observedAt'
  | 'providerClass'
  | 'integrationMode'
  | 'environmentKind'
  | 'renderedMs'
  | 'viewableMs'
  | 'aiEligibleMs'
  | 'qualifiedMs'
  | 'passiveMs'
  | 'passiveBillableMs'
  | 'weightedBillablePpmMs'
  | 'policyVersion'
  | 'alphaPpm'
  | 'passiveCapRatioPpm'
  | 'passiveSessionCapMs'
  | 'minimumQualifiedMs'
  | 'classificationConfidencePpm'
  | 'unknownEventRatePpm'
> {
  if (!Number.isFinite(row.observedAt.getTime())) {
    throw new Error('stored shadow fact timestamp must be valid');
  }
  return {
    ...row,
    observedAt: row.observedAt.toISOString(),
  };
}

function parseWindow(window: TemporalWindow): { start: Date; end: Date } {
  const startMs = Date.parse(window.start);
  const endMs = Date.parse(window.end);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) {
    throw new Error('dataset source window must be valid and have positive duration');
  }
  return { start: new Date(startMs), end: new Date(endMs) };
}
