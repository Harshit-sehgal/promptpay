const TOTP_PATTERN = /^\d{6}$/;
const BACKUP_CODE_PATTERN = /^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/;

export interface TwoFactorProof {
  twoFactorToken?: string;
  twoFactorBackupCode?: string;
}

/** Preserve both supported credential formats without silently destroying either one. */
export function normalizeTwoFactorInput(value: string): string {
  return value
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9-]/g, '')
    .slice(0, 14);
}

export function isValidTwoFactorInput(value: string): boolean {
  const normalized = normalizeTwoFactorInput(value);
  return TOTP_PATTERN.test(normalized) || BACKUP_CODE_PATTERN.test(normalized);
}

/** Map the single browser field onto the distinct API properties. */
export function twoFactorProofForInput(value?: string): TwoFactorProof {
  if (!value) return {};
  const normalized = normalizeTwoFactorInput(value);
  if (TOTP_PATTERN.test(normalized)) return { twoFactorToken: normalized };
  if (BACKUP_CODE_PATTERN.test(normalized)) return { twoFactorBackupCode: normalized };
  return {};
}
