import { createHash } from 'node:crypto';
import { Injectable } from '@nestjs/common';

import {
  type AttentionExperimentAssignment,
  attentionExperimentAssignmentSchema,
  type AttentionExperimentDefinition,
  attentionExperimentDefinitionSchema,
} from '@ateva/agent-protocol';
import { Prisma } from '@ateva/db';

import { PrismaService } from '../config/prisma.service';

const PPM_SCALE = 1_000_000;
const SUBJECT_KEY_PATTERN = /^[a-f0-9]{64}$/;

export type ExperimentAssignmentResult = AttentionExperimentAssignment & {
  persisted: boolean;
  financialSideEffects: false;
};

/** Assign an already-pseudonymized subject deterministically to a variant. */
export function assignAttentionExperimentVariant(
  definition: AttentionExperimentDefinition,
  subjectKey: string,
  assignedAt: Date | string,
): AttentionExperimentAssignment {
  assertSubjectKey(subjectKey);
  const assignedDate = parseDate(assignedAt);
  const firstPolicyVersion = definition.variants[0]?.policyVersion;
  if (!firstPolicyVersion) throw new Error('experiment requires at least one policy version');

  if (!isAssignmentOpen(definition, assignedDate)) {
    return attentionExperimentAssignmentSchema.parse({
      experimentId: definition.experimentId,
      subjectKey,
      variant: 'ineligible',
      assignedAt: assignedDate.toISOString(),
      policyVersion: firstPolicyVersion,
      eligibility: 'ineligible',
    });
  }

  const bucket = assignmentBucket(definition.experimentId, subjectKey);
  let cumulative = 0;
  for (const variant of definition.variants) {
    cumulative += variant.allocationPpm;
    if (bucket < cumulative) {
      return attentionExperimentAssignmentSchema.parse({
        experimentId: definition.experimentId,
        subjectKey,
        variant: variant.variant,
        assignedAt: assignedDate.toISOString(),
        policyVersion: variant.policyVersion,
        eligibility: 'eligible',
      });
    }
  }
  // The definition schema requires exactly one million ppm. This guard keeps
  // a malformed object from silently assigning outside the last variant.
  throw new Error('experiment allocation did not cover the assignment bucket');
}

export function assignmentBucket(experimentId: string, subjectKey: string): number {
  assertSubjectKey(subjectKey);
  const digest = createHash('sha256').update(`${experimentId}:${subjectKey}`).digest('hex');
  return Number(BigInt(`0x${digest.slice(0, 15)}`) % BigInt(PPM_SCALE));
}

@Injectable()
export class AttentionExperimentService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Persist a deterministic assignment exactly once. A concurrent unique-key
   * race is resolved by reading the winner; no assignment mutates money or
   * policy state.
   */
  async assign(
    experimentId: string,
    subjectKey: string,
    assignedAt: Date | string = new Date(),
  ): Promise<ExperimentAssignmentResult> {
    if (!experimentId) throw new Error('experimentId is required');
    assertSubjectKey(subjectKey);
    const assignedDate = parseDate(assignedAt);
    const existing = await this.prisma.attentionExperimentAssignment.findUnique({
      where: { experimentId_subjectKey: { experimentId, subjectKey } },
    });
    if (existing) return toResult(existing, true);

    const row = await this.prisma.attentionExperiment.findUnique({
      where: { id: experimentId },
      select: {
        id: true,
        name: true,
        status: true,
        assignmentUnit: true,
        variants: true,
        assignmentStartedAt: true,
        assignmentEndedAt: true,
        outcomeWindowDays: true,
        primaryMetric: true,
        guardrailMetrics: true,
      },
    });
    if (!row) throw new Error('experiment was not found');

    const definition = attentionExperimentDefinitionSchema.parse({
      experimentId: row.id,
      name: row.name,
      status: row.status,
      assignmentUnit: row.assignmentUnit,
      variants: row.variants,
      assignmentStartedAt: row.assignmentStartedAt?.toISOString() ?? null,
      assignmentEndedAt: row.assignmentEndedAt?.toISOString() ?? null,
      outcomeWindowDays: row.outcomeWindowDays,
      primaryMetric: row.primaryMetric,
      guardrailMetrics: row.guardrailMetrics,
    });
    const assignment = assignAttentionExperimentVariant(definition, subjectKey, assignedDate);

    try {
      const created = await this.prisma.attentionExperimentAssignment.create({
        data: {
          experimentId: assignment.experimentId,
          subjectKey: assignment.subjectKey,
          variant: assignment.variant,
          policyVersion: assignment.policyVersion,
          eligibility: assignment.eligibility,
          assignedAt: assignedDate,
        },
      });
      return toResult(created, false);
    } catch (error: unknown) {
      if (!isUniqueViolation(error)) throw error;
      const winner = await this.prisma.attentionExperimentAssignment.findUnique({
        where: { experimentId_subjectKey: { experimentId, subjectKey } },
      });
      if (!winner) throw error;
      return toResult(winner, true);
    }
  }
}

function isAssignmentOpen(definition: AttentionExperimentDefinition, assignedAt: Date): boolean {
  if (definition.status !== 'running') return false;
  if (
    definition.assignmentStartedAt &&
    assignedAt.getTime() < Date.parse(definition.assignmentStartedAt)
  ) {
    return false;
  }
  if (
    definition.assignmentEndedAt &&
    assignedAt.getTime() >= Date.parse(definition.assignmentEndedAt)
  ) {
    return false;
  }
  return true;
}

function assertSubjectKey(subjectKey: string): void {
  if (!SUBJECT_KEY_PATTERN.test(subjectKey)) {
    throw new Error('subjectKey must be a keyed 256-bit digest');
  }
}

function parseDate(value: Date | string): Date {
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error('assignedAt must be a valid date');
  return date;
}

function toResult(
  assignment: {
    experimentId: string;
    subjectKey: string;
    variant: string;
    assignedAt: Date;
    policyVersion: number;
    eligibility: string;
  },
  persisted: boolean,
): ExperimentAssignmentResult {
  return {
    ...attentionExperimentAssignmentSchema.parse({
      experimentId: assignment.experimentId,
      subjectKey: assignment.subjectKey,
      variant: assignment.variant,
      assignedAt: assignment.assignedAt.toISOString(),
      policyVersion: assignment.policyVersion,
      eligibility: assignment.eligibility,
    }),
    persisted,
    financialSideEffects: false,
  };
}

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}
