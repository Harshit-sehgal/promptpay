import { describe, expect, it } from 'vitest';

import {
  isValidTwoFactorInput,
  normalizeTwoFactorInput,
  twoFactorProofForInput,
} from './two-factor-input';

describe('two-factor browser input', () => {
  it('keeps a six-digit TOTP code on the token field', () => {
    expect(twoFactorProofForInput(' 123456 ')).toEqual({ twoFactorToken: '123456' });
  });

  it('normalizes but does not strip the separators from a canonical backup code', () => {
    expect(normalizeTwoFactorInput(' abcd-efgh-jkmn ')).toBe('ABCD-EFGH-JKMN');
    expect(twoFactorProofForInput('abcd-efgh-jkmn')).toEqual({
      twoFactorBackupCode: 'ABCD-EFGH-JKMN',
    });
  });

  it('rejects ambiguous or malformed backup codes instead of sending them as TOTP', () => {
    expect(isValidTwoFactorInput('ABCD-EFGH-I0O1')).toBe(false);
    expect(twoFactorProofForInput('ABCD-EFGH-I0O1')).toEqual({});
  });
});
