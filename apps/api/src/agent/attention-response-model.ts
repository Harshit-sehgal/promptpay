import { createHash } from 'node:crypto';

import type { ShadowSessionFact } from '@ateva/agent-protocol';
import {
  type AttentionDatasetManifest,
  attentionDatasetManifestSchema,
  type AttentionModelArtifact,
  attentionModelArtifactSchema,
} from '@ateva/agent-protocol';

export const MODEL_FEATURE_ALLOWLIST = [
  'rendered_ms',
  'viewable_ms',
  'ai_eligible_ms',
  'qualified_ms',
  'passive_ms',
  'passive_billable_ms',
  'weighted_billable_ppm_ms',
  'policy_version',
  'alpha_ppm',
  'passive_cap_ratio_ppm',
  'passive_session_cap_ms',
  'minimum_qualified_ms',
  'classification_confidence_ppm',
  'unknown_event_rate_ppm',
  'provider_class_claude_code',
  'provider_class_unknown',
  'integration_mode_native_hook',
  'integration_mode_heuristic_shadow',
  'environment_sandbox',
  'environment_staging',
] as const;

export type ModelFeatureName = (typeof MODEL_FEATURE_ALLOWLIST)[number];
export type ResponseModelFamily =
  'advertiser_outcome' | 'advertiser_retention' | 'user_retention' | 'cost' | 'fraud_quality_risk';

export type TemporalWindow = {
  start: string;
  end: string;
};

export type ModelObservation = {
  /** A keyed digest, never a user/device/session identifier. */
  id: string;
  observedAt: string;
  features: Readonly<Record<string, number>>;
  outcome: number;
};

export type ModelTrainingRequest = {
  modelId: string;
  modelVersion: string;
  modelFamily: ResponseModelFamily;
  datasetId: string;
  datasetVersion: number;
  datasetSource: AttentionDatasetManifest['source'];
  featureNames: readonly ModelFeatureName[];
  outcomeName: string;
  observations: readonly ModelObservation[];
  trainWindow: TemporalWindow;
  validationWindow: TemporalWindow;
  testWindow: TemporalWindow;
  trainedAt: string;
  previousModelVersion?: string | null;
  rollbackOnDrift?: boolean;
  confidenceLevelPpm?: number;
  bootstrapReplicates?: number;
  iterations?: number;
};

export type TemporalSplits = {
  train: readonly ModelObservation[];
  validation: readonly ModelObservation[];
  test: readonly ModelObservation[];
};

export type InterpretableResponseModel = {
  modelId: string;
  modelVersion: string;
  modelFamily: ResponseModelFamily;
  link: 'logistic' | 'identity';
  featureNames: readonly ModelFeatureName[];
  featureScales: Readonly<Record<string, number>>;
  coefficients: Readonly<Record<string, number>>;
  intercept: number;
  datasetDigest: string;
};

export type ModelSplitEvaluation = {
  split: 'train' | 'validation' | 'test';
  sampleSize: number;
  outcomeMean: number;
  predictionMean: number;
  brierScorePpm: number;
  expectedCalibrationErrorPpm: number;
  meanAbsoluteError: number;
};

export type TrainedResponseModel = {
  model: InterpretableResponseModel;
  datasetManifest: AttentionDatasetManifest;
  artifact: AttentionModelArtifact;
  evaluations: readonly ModelSplitEvaluation[];
  financialSideEffects: false;
};

export const MODEL_PARAMETER_VERSION = 'interpretable-response-model-v1';
const MAX_FEATURE_VALUE = 1e15;
const DEFAULT_CONFIDENCE_PPM = 950_000;
const DEFAULT_BOOTSTRAP_REPLICATES = 200;
const DEFAULT_ITERATIONS = 800;

/**
 * Validate the model input before it reaches a trainer. Temporal membership is
 * deliberately checked separately by `splitTemporalObservations`; rows
 * outside the declared windows are rejected instead of silently discarded.
 */
export function validateModelObservations(
  observations: readonly ModelObservation[],
  featureNames: readonly ModelFeatureName[],
  family: ResponseModelFamily,
): void {
  const names = new Set(featureNames);
  if (names.size !== featureNames.length || featureNames.length === 0) {
    throw new Error('model feature names must be unique and non-empty');
  }
  for (const name of featureNames) {
    if (!isAllowedFeatureName(name)) throw new Error(`feature is not allowlisted: ${name}`);
  }

  const ids = new Set<string>();
  for (const observation of observations) {
    if (!/^[a-f0-9]{64}$/.test(observation.id)) {
      throw new Error('model observation id must be a keyed digest');
    }
    if (ids.has(observation.id)) throw new Error('duplicate model observation id');
    ids.add(observation.id);
    if (!Number.isFinite(Date.parse(observation.observedAt))) {
      throw new Error('model observation timestamp must be valid');
    }
    if (
      !Number.isFinite(observation.outcome) ||
      Math.abs(observation.outcome) > MAX_FEATURE_VALUE
    ) {
      throw new Error('model outcome must be finite and bounded');
    }
    if (family !== 'cost' && (observation.outcome < 0 || observation.outcome > 1)) {
      throw new Error('binary response-model outcomes must be between zero and one');
    }
    const suppliedNames = Object.keys(observation.features);
    for (const suppliedName of suppliedNames) {
      if (!names.has(suppliedName as ModelFeatureName)) {
        throw new Error(`observation contains a non-allowlisted feature: ${suppliedName}`);
      }
    }
    for (const name of featureNames) {
      const value = observation.features[name];
      if (!Number.isFinite(value) || Math.abs(value) > MAX_FEATURE_VALUE) {
        throw new Error(`feature value is not finite and bounded: ${name}`);
      }
    }
  }
}

/** Split only by time; a future row can never enter train or validation. */
export function splitTemporalObservations(
  observations: readonly ModelObservation[],
  windows: {
    train: TemporalWindow;
    validation: TemporalWindow;
    test: TemporalWindow;
  },
): TemporalSplits {
  validateTemporalWindows(windows);
  const parsed = observations
    .map((observation) => ({ observation, time: Date.parse(observation.observedAt) }))
    .sort(
      (left, right) =>
        left.time - right.time || left.observation.id.localeCompare(right.observation.id),
    );
  const allStart = Date.parse(windows.train.start);
  const allEnd = Date.parse(windows.test.end);
  const train: ModelObservation[] = [];
  const validation: ModelObservation[] = [];
  const test: ModelObservation[] = [];
  for (const item of parsed) {
    if (item.time < allStart || item.time >= allEnd) {
      throw new Error('model observation falls outside the declared temporal windows');
    }
    if (insideWindow(item.time, windows.train)) train.push(item.observation);
    else if (insideWindow(item.time, windows.validation)) validation.push(item.observation);
    else if (insideWindow(item.time, windows.test)) test.push(item.observation);
    else throw new Error('model observation falls in a temporal gap');
  }
  if (train.length < 2 || validation.length < 1 || test.length < 1) {
    throw new Error('train, validation, and test splits need independent observations');
  }
  return { train, validation, test };
}

/** Build a digest-bearing manifest from the same sanitized rows used to train. */
export function buildAttentionDatasetManifest(input: {
  datasetId: string;
  datasetVersion: number;
  sourceWindow: TemporalWindow;
  featureNames: readonly ModelFeatureName[];
  outcomeNames: readonly string[];
  observations: readonly ModelObservation[];
  generatedAt: string;
  source: AttentionDatasetManifest['source'];
}): AttentionDatasetManifest {
  validateWindow(input.sourceWindow);
  validateModelObservations(input.observations, input.featureNames, 'cost');
  const rows = [...input.observations]
    .sort((left, right) => left.id.localeCompare(right.id))
    .map((observation) => ({
      id: observation.id,
      observedAt: observation.observedAt,
      features: pickFeatures(observation.features, input.featureNames),
      outcome: observation.outcome,
    }));
  const digest = sha256(
    stableSerialize({
      datasetVersion: input.datasetVersion,
      featureNames: [...input.featureNames],
      outcomeNames: [...input.outcomeNames],
      rows,
    }),
  );
  return attentionDatasetManifestSchema.parse({
    datasetId: input.datasetId,
    datasetVersion: input.datasetVersion,
    sourceWindow: input.sourceWindow,
    rowCount: rows.length,
    featureNames: [...input.featureNames],
    outcomeNames: [...input.outcomeNames],
    digest,
    generatedAt: input.generatedAt,
    source: input.source,
  });
}

/** Convert a stored fact into a model row without exposing its pseudonymous keys as features. */
export function observationFromShadowFact(
  fact: Pick<
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
  >,
  outcome: number,
  featureNames: readonly ModelFeatureName[],
): ModelObservation {
  const numeric: Record<string, number> = {
    rendered_ms: fact.renderedMs,
    viewable_ms: fact.viewableMs,
    ai_eligible_ms: fact.aiEligibleMs,
    qualified_ms: fact.qualifiedMs,
    passive_ms: fact.passiveMs,
    passive_billable_ms: fact.passiveBillableMs,
    weighted_billable_ppm_ms: Number(fact.weightedBillablePpmMs) / 1_000_000,
    policy_version: fact.policyVersion,
    alpha_ppm: Number(fact.alphaPpm),
    passive_cap_ratio_ppm: Number(fact.passiveCapRatioPpm),
    passive_session_cap_ms: fact.passiveSessionCapMs,
    minimum_qualified_ms: fact.minimumQualifiedMs,
    classification_confidence_ppm: Number(fact.classificationConfidencePpm),
    unknown_event_rate_ppm: Number(fact.unknownEventRatePpm),
    provider_class_claude_code: fact.providerClass === 'claude_code' ? 1 : 0,
    provider_class_unknown: fact.providerClass === 'unknown' ? 1 : 0,
    integration_mode_native_hook: fact.integrationMode === 'native_hook' ? 1 : 0,
    integration_mode_heuristic_shadow: fact.integrationMode === 'heuristic_shadow' ? 1 : 0,
    environment_sandbox: fact.environmentKind === 'sandbox' ? 1 : 0,
    environment_staging: fact.environmentKind === 'staging' ? 1 : 0,
  };
  const features = Object.fromEntries(featureNames.map((name) => [name, numeric[name]]));
  const observation = { id: fact.sessionKey, observedAt: fact.observedAt, features, outcome };
  validateModelObservations([observation], featureNames, 'cost');
  return observation;
}

/** Train a regularized logistic or linear model with no external side effect. */
export function trainResponseModel(request: ModelTrainingRequest): TrainedResponseModel {
  validateModelObservations(request.observations, request.featureNames, request.modelFamily);
  const windows = {
    train: request.trainWindow,
    validation: request.validationWindow,
    test: request.testWindow,
  };
  const splits = splitTemporalObservations(request.observations, windows);
  const datasetManifest = buildAttentionDatasetManifest({
    datasetId: request.datasetId,
    datasetVersion: request.datasetVersion,
    sourceWindow: { start: request.trainWindow.start, end: request.testWindow.end },
    featureNames: request.featureNames,
    outcomeNames: [request.outcomeName],
    observations: request.observations,
    generatedAt: request.trainedAt,
    source: request.datasetSource,
  });
  const model = fitModel(
    request,
    splits.train,
    datasetManifest.digest,
    request.iterations ?? DEFAULT_ITERATIONS,
  );
  const evaluations = (['train', 'validation', 'test'] as const).map((split) =>
    evaluateModel(model, split, splits[split]),
  );
  const testEvaluation = evaluations.find((evaluation) => evaluation.split === 'test');
  if (!testEvaluation) throw new Error('test evaluation was not produced');
  const confidenceLevelPpm = request.confidenceLevelPpm ?? DEFAULT_CONFIDENCE_PPM;
  if (
    !Number.isInteger(confidenceLevelPpm) ||
    confidenceLevelPpm < 0 ||
    confidenceLevelPpm > 1_000_000
  ) {
    throw new Error('confidence level must be a ppm integer');
  }
  const uncertainty = bootstrapPredictionMean(
    model,
    splits.test,
    request.bootstrapReplicates ?? DEFAULT_BOOTSTRAP_REPLICATES,
    confidenceLevelPpm,
    datasetManifest.digest,
  );
  const calibration = {
    method: 'none' as const,
    brierScorePpm: testEvaluation.brierScorePpm,
    expectedCalibrationErrorPpm: testEvaluation.expectedCalibrationErrorPpm,
  };
  const artifactBase = {
    modelId: request.modelId,
    modelVersion: request.modelVersion,
    modelFamily: request.modelFamily,
    datasetDigest: datasetManifest.digest,
    featureNames: [...request.featureNames],
    trainWindow: request.trainWindow,
    validationWindow: request.validationWindow,
    testWindow: request.testWindow,
    trainedAt: request.trainedAt,
    status: 'shadow' as const,
    calibration,
    uncertainty,
    rollback: {
      previousModelVersion: request.previousModelVersion ?? null,
      rollbackOnDrift: request.rollbackOnDrift ?? true,
    },
  };
  const artifactDigest = responseModelArtifactDigest(artifactBase, model);
  const artifact = attentionModelArtifactSchema.parse({ ...artifactBase, artifactDigest });
  return { model, datasetManifest, artifact, evaluations, financialSideEffects: false };
}

/** Recompute the digest over model metadata and parameters, excluding its digest itself. */
export function responseModelArtifactDigest(
  artifact: Omit<AttentionModelArtifact, 'artifactDigest'>,
  model: InterpretableResponseModel,
): string {
  return sha256(
    stableSerialize({
      parameterVersion: MODEL_PARAMETER_VERSION,
      artifact,
      model,
    }),
  );
}

export function predictResponseModel(
  model: InterpretableResponseModel,
  features: Readonly<Record<string, number>>,
): number {
  let score = model.intercept;
  for (const name of model.featureNames) {
    const value = features[name];
    if (!Number.isFinite(value)) throw new Error(`missing or invalid model feature: ${name}`);
    score += model.coefficients[name] * (value / model.featureScales[name]);
  }
  if (model.link === 'identity') return score;
  return sigmoid(score);
}

export type RegisteredShadowModel = {
  artifact: AttentionModelArtifact;
  model: InterpretableResponseModel;
  frozen: boolean;
};

/** In-memory registry used by tests/offline jobs; it has no activation method. */
export class ShadowModelRegistry {
  private readonly models = new Map<string, RegisteredShadowModel>();

  register(result: TrainedResponseModel): RegisteredShadowModel {
    if (result.artifact.status === 'approved') {
      throw new Error('shadow registry cannot register an approved model');
    }
    const key = modelKey(result.artifact.modelId, result.artifact.modelVersion);
    const current = this.models.get(key);
    if (current && current.artifact.artifactDigest !== result.artifact.artifactDigest) {
      throw new Error('model version already exists with a different artifact digest');
    }
    const registered = current ?? { artifact: result.artifact, model: result.model, frozen: false };
    this.models.set(key, registered);
    return registered;
  }

  get(modelId: string, modelVersion: string): RegisteredShadowModel | null {
    return this.models.get(modelKey(modelId, modelVersion)) ?? null;
  }

  list(): readonly RegisteredShadowModel[] {
    return [...this.models.values()];
  }

  freeze(modelId: string, modelVersion: string): RegisteredShadowModel {
    const model = this.get(modelId, modelVersion);
    if (!model) throw new Error('model was not found');
    model.frozen = true;
    return model;
  }
}

function fitModel(
  request: ModelTrainingRequest,
  observations: readonly ModelObservation[],
  datasetDigest: string,
  iterations: number,
): InterpretableResponseModel {
  if (!Number.isInteger(iterations) || iterations < 1 || iterations > 10_000) {
    throw new Error('model iterations are out of bounds');
  }
  const scales = Object.fromEntries(
    request.featureNames.map((name) => [
      name,
      Math.max(1, ...observations.map((observation) => Math.abs(observation.features[name]))),
    ]),
  );
  const weights = Object.fromEntries(request.featureNames.map((name) => [name, 0]));
  const binary = request.modelFamily !== 'cost';
  const mean =
    observations.reduce((total, observation) => total + observation.outcome, 0) /
    observations.length;
  let intercept = binary ? logit(clamp(mean, 0.01, 0.99)) : mean;
  const learningRate = binary ? 0.1 : 0.03;
  const l2 = 0.01;
  for (let iteration = 0; iteration < iterations; iteration++) {
    const gradients = Object.fromEntries(request.featureNames.map((name) => [name, 0]));
    let interceptGradient = 0;
    for (const observation of observations) {
      const prediction = binary
        ? sigmoid(
            intercept + linearScore(observation.features, request.featureNames, weights, scales),
          )
        : intercept + linearScore(observation.features, request.featureNames, weights, scales);
      const error = prediction - observation.outcome;
      interceptGradient += error;
      for (const name of request.featureNames) {
        gradients[name] += error * (observation.features[name] / scales[name]);
      }
    }
    const divisor = observations.length;
    intercept -= learningRate * (interceptGradient / divisor);
    for (const name of request.featureNames) {
      weights[name] -= learningRate * (gradients[name] / divisor + l2 * weights[name]);
    }
  }
  return {
    modelId: request.modelId,
    modelVersion: request.modelVersion,
    modelFamily: request.modelFamily,
    link: binary ? 'logistic' : 'identity',
    featureNames: [...request.featureNames],
    featureScales: scales,
    coefficients: weights,
    intercept,
    datasetDigest,
  };
}

function evaluateModel(
  model: InterpretableResponseModel,
  split: ModelSplitEvaluation['split'],
  observations: readonly ModelObservation[],
): ModelSplitEvaluation {
  const predictions = observations.map((observation) =>
    predictResponseModel(model, observation.features),
  );
  const outcomeMean = mean(observations.map((observation) => observation.outcome));
  const predictionMean = mean(predictions);
  const squaredErrors = observations.map(
    (observation, index) => (predictions[index] - observation.outcome) ** 2,
  );
  const absoluteErrors = observations.map((observation, index) =>
    Math.abs(predictions[index] - observation.outcome),
  );
  return {
    split,
    sampleSize: observations.length,
    outcomeMean,
    predictionMean,
    brierScorePpm:
      model.link === 'logistic'
        ? Math.min(1_000_000, Math.round(mean(squaredErrors) * 1_000_000))
        : 0,
    expectedCalibrationErrorPpm:
      model.link === 'logistic' ? calibrationErrorPpm(predictions, observations) : 0,
    meanAbsoluteError: mean(absoluteErrors),
  };
}

function bootstrapPredictionMean(
  model: InterpretableResponseModel,
  observations: readonly ModelObservation[],
  replicates: number,
  confidenceLevelPpm: number,
  seedText: string,
): AttentionModelArtifact['uncertainty'] {
  if (!Number.isInteger(replicates) || replicates < 20 || replicates > 10_000) {
    throw new Error('bootstrap replicate count is out of bounds');
  }
  const random = seededRandom(seedText);
  const means: number[] = [];
  for (let replicate = 0; replicate < replicates; replicate++) {
    let total = 0;
    for (let index = 0; index < observations.length; index++) {
      const sample = observations[Math.floor(random() * observations.length)];
      total += predictResponseModel(model, sample.features);
    }
    means.push(total / observations.length);
  }
  means.sort((left, right) => left - right);
  const tail = (1 - confidenceLevelPpm / 1_000_000) / 2;
  const lower = means[Math.floor(tail * (means.length - 1))] ?? 0;
  const upper = means[Math.ceil((1 - tail) * (means.length - 1))] ?? 0;
  return {
    method: 'bootstrap',
    confidenceLevelPpm,
    sampleSize: observations.length,
    lowerBound: lower,
    upperBound: upper,
  };
}

function calibrationErrorPpm(
  predictions: readonly number[],
  observations: readonly ModelObservation[],
): number {
  if (predictions.length === 0) return 0;
  const bins = Array.from({ length: 10 }, () => ({ count: 0, prediction: 0, outcome: 0 }));
  for (let index = 0; index < predictions.length; index++) {
    const prediction = clamp(predictions[index], 0, 1);
    const bin = Math.min(9, Math.floor(prediction * 10));
    bins[bin].count++;
    bins[bin].prediction += prediction;
    bins[bin].outcome += observations[index].outcome;
  }
  return Math.min(
    1_000_000,
    Math.round(
      bins.reduce(
        (total, bin) =>
          total +
          (bin.count
            ? (bin.count / predictions.length) *
              Math.abs(bin.prediction / bin.count - bin.outcome / bin.count)
            : 0),
        0,
      ) * 1_000_000,
    ),
  );
}

function validateTemporalWindows(windows: {
  train: TemporalWindow;
  validation: TemporalWindow;
  test: TemporalWindow;
}): void {
  const parsed = [windows.train, windows.validation, windows.test].map((window) => ({
    start: Date.parse(window.start),
    end: Date.parse(window.end),
  }));
  if (
    parsed.some(
      ({ start, end }) => !Number.isFinite(start) || !Number.isFinite(end) || end <= start,
    )
  ) {
    throw new Error('model windows must be valid and have positive duration');
  }
  if (parsed[0].end > parsed[1].start || parsed[1].end > parsed[2].start) {
    throw new Error('model windows must be chronological and non-overlapping');
  }
}

function validateWindow(window: TemporalWindow): void {
  const start = Date.parse(window.start);
  const end = Date.parse(window.end);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
    throw new Error('dataset source window must be valid and have positive duration');
  }
}

function insideWindow(time: number, window: TemporalWindow): boolean {
  return time >= Date.parse(window.start) && time < Date.parse(window.end);
}

function isAllowedFeatureName(name: string): name is ModelFeatureName {
  return (MODEL_FEATURE_ALLOWLIST as readonly string[]).includes(name);
}

function pickFeatures(
  features: Readonly<Record<string, number>>,
  names: readonly ModelFeatureName[],
): Record<string, number> {
  return Object.fromEntries(names.map((name) => [name, features[name]]));
}

function linearScore(
  features: Readonly<Record<string, number>>,
  names: readonly ModelFeatureName[],
  coefficients: Readonly<Record<string, number>>,
  scales: Readonly<Record<string, number>>,
): number {
  return names.reduce(
    (total, name) => total + coefficients[name] * (features[name] / scales[name]),
    0,
  );
}

function sigmoid(value: number): number {
  if (value >= 0) {
    const exp = Math.exp(-value);
    return 1 / (1 + exp);
  }
  const exp = Math.exp(value);
  return exp / (1 + exp);
}

function logit(value: number): number {
  return Math.log(value / (1 - value));
}

function clamp(value: number, lower: number, upper: number): number {
  return Math.min(upper, Math.max(lower, value));
}

function mean(values: readonly number[]): number {
  return values.length ? values.reduce((total, value) => total + value, 0) / values.length : 0;
}

function seededRandom(seedText: string): () => number {
  let state = Number.parseInt(sha256(seedText).slice(0, 8), 16) || 1;
  return () => {
    state = (1664525 * state + 1013904223) >>> 0;
    return state / 0x1_0000_0000;
  };
}

function modelKey(modelId: string, modelVersion: string): string {
  return `${modelId}:${modelVersion}`;
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function stableSerialize(value: unknown): string {
  if (typeof value === 'bigint') return `${value.toString()}n`;
  if (value === null) return 'null';
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(',')}]`;
  if (typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => `${JSON.stringify(key)}:${stableSerialize(child)}`)
      .join(',')}}`;
  }
  return 'undefined';
}
