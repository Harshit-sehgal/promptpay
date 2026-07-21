import * as crypto from 'crypto';

import { signPayload, verifySignature } from './signing';

/** Current version of the detector-evidence contract. */
export const DETECTOR_VERSION = '1.0.0';

/**
 * Versioned detector-evidence contract (P0 earning workflow).
 *
 * Evidence replaces the flat, client-declared `signals` array. Each evidence
 * item carries enough metadata for the server to decide whether a wait was
 * directly observed by a trusted source or merely inferred, which adapter
 * produced it, and a per-item HMAC so a modified client cannot silently
 * inject corroboration it did not sign.
 */

export const EVIDENCE_SIGNAL_TYPES = [
  'ai_generation',
  'active_task',
  'command_execution',
  'lifecycle_event',
  'inactivity',
] as const;

export type EvidenceSignalType = (typeof EVIDENCE_SIGNAL_TYPES)[number];

export const EVIDENCE_SOURCE_TYPES = ['observed', 'inferred'] as const;

export type EvidenceSourceType = (typeof EVIDENCE_SOURCE_TYPES)[number];

export interface DetectorEvidence {
  /** Signal category. */
  type: EvidenceSignalType;
  /** Whether this evidence was directly observed by an independent source or inferred heuristically. */
  sourceType: EvidenceSourceType;
  /** Adapter/source identifier, e.g. `vscode.task`, `cli.runner`, `extension.ai-hook`. */
  adapterId: string;
  /** Detector/version that produced this evidence. */
  detectorVersion: string;
  /** Unix timestamp (ms) when the evidence was produced. */
  timestamp: number;
  /** Wait-state identifier this evidence belongs to (replay protection). */
  waitStateId: string;
  /** Session identifier this evidence belongs to (replay protection). */
  sessionId: string;
  /** Extra correlation identifier that links related evidence items. */
  correlationId: string;
  /** HMAC-SHA256 over the canonical evidence fields, produced with the device secret. */
  signature: string;
}

type EvidencePayload = Omit<DetectorEvidence, 'signature'>;

/** Canonicalize the signed portion of an evidence item for stable signing. */
export function canonicalEvidencePayload(evidence: EvidencePayload): Record<string, unknown> {
  return {
    type: evidence.type,
    sourceType: evidence.sourceType,
    adapterId: evidence.adapterId,
    detectorVersion: evidence.detectorVersion,
    timestamp: evidence.timestamp,
    waitStateId: evidence.waitStateId,
    sessionId: evidence.sessionId,
    correlationId: evidence.correlationId,
  };
}

/** Sign a single evidence item with the device secret. */
export function signEvidence(evidence: EvidencePayload, secret: string): string {
  return signPayload(canonicalEvidencePayload(evidence), secret);
}

/** Verify a single evidence item's signature with the device secret. */
export function verifyEvidence(evidence: DetectorEvidence, secret: string): boolean {
  return verifySignature(canonicalEvidencePayload(evidence), secret, evidence.signature);
}

/** Map a verified evidence item to the legacy wait-signal shape. */
export function evidenceToWaitSignal(evidence: Pick<DetectorEvidence, 'type'>): {
  type: EvidenceSignalType;
} {
  return { type: evidence.type };
}

/** Primary evidence categories that can authorize ad serving and billing. */
export const PRIMARY_EVIDENCE_TYPES: readonly EvidenceSignalType[] = [
  'ai_generation',
  'active_task',
  'command_execution',
];

/** Whether the evidence type is a primary (billable) signal. */
export function isPrimaryEvidenceType(
  type: EvidenceSignalType,
): type is 'ai_generation' | 'active_task' | 'command_execution' {
  return (PRIMARY_EVIDENCE_TYPES as readonly string[]).includes(type);
}

/**
 * Hash a correlation/session identifier deterministically for analytics.
 * Uses sha256; the caller decides how much entropy to expose.
 */
export function hashCorrelationId(id: string): string {
  return crypto.createHash('sha256').update(id, 'utf8').digest('hex');
}
