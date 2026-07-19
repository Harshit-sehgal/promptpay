import { describe, expect, it } from 'vitest';
import { BadRequestException } from '@nestjs/common';

import { RecoveryDebtCaseStatus } from '@waitlayer/db';

import {
  RECOVERY_DEBT_TRANSITIONS,
  validateRecoveryDebtTransition,
} from './admin-recovery-debt-state-machine';

describe('admin-recovery-debt-state-machine', () => {
  const valid: Array<[RecoveryDebtCaseStatus, RecoveryDebtCaseStatus]> = [
    [RecoveryDebtCaseStatus.open, RecoveryDebtCaseStatus.in_collections],
    [RecoveryDebtCaseStatus.open, RecoveryDebtCaseStatus.recovered],
    [RecoveryDebtCaseStatus.open, RecoveryDebtCaseStatus.written_off],
    [RecoveryDebtCaseStatus.open, RecoveryDebtCaseStatus.closed],
    [RecoveryDebtCaseStatus.in_collections, RecoveryDebtCaseStatus.open],
    [RecoveryDebtCaseStatus.in_collections, RecoveryDebtCaseStatus.recovered],
    [RecoveryDebtCaseStatus.in_collections, RecoveryDebtCaseStatus.written_off],
    [RecoveryDebtCaseStatus.in_collections, RecoveryDebtCaseStatus.closed],
  ];

  it.each(valid)('allows %s → %s', (from, to) => {
    expect(() => validateRecoveryDebtTransition(from, to)).not.toThrow();
  });

  const invalid: Array<[RecoveryDebtCaseStatus, RecoveryDebtCaseStatus]> = [
    [RecoveryDebtCaseStatus.recovered, RecoveryDebtCaseStatus.open],
    [RecoveryDebtCaseStatus.recovered, RecoveryDebtCaseStatus.in_collections],
    [RecoveryDebtCaseStatus.written_off, RecoveryDebtCaseStatus.closed],
    [RecoveryDebtCaseStatus.closed, RecoveryDebtCaseStatus.open],
    [RecoveryDebtCaseStatus.open, RecoveryDebtCaseStatus.open],
  ];

  it.each(invalid)('rejects %s → %s', (from, to) => {
    expect(() => validateRecoveryDebtTransition(from, to)).toThrow(BadRequestException);
  });

  it('marks terminal states as having no outgoing transitions', () => {
    expect(RECOVERY_DEBT_TRANSITIONS[RecoveryDebtCaseStatus.recovered]).toEqual([]);
    expect(RECOVERY_DEBT_TRANSITIONS[RecoveryDebtCaseStatus.written_off]).toEqual([]);
    expect(RECOVERY_DEBT_TRANSITIONS[RecoveryDebtCaseStatus.closed]).toEqual([]);
  });
});
