import { describe, expect, it } from 'vitest';

import { AuthTotpTrait } from './auth-totp.trait';

/**
 * The exact pattern the BROWSER enforces before it will send a backup code, in
 * `apps/web/src/lib/two-factor-input.ts` (`BACKUP_CODE_PATTERN`). Keep this
 * literal in sync with that file — it is duplicated deliberately so a change on
 * either side of the boundary fails here.
 *
 * The web classifies a single input field into `twoFactorToken` (6-digit TOTP)
 * or `twoFactorBackupCode`, and sends NEITHER when the value matches neither
 * pattern. So if the server's alphabet ever drifted to include a character the
 * client rejects, real backup codes would be silently dropped by the client and
 * account recovery would fail with no server-side trace.
 */
const WEB_ACCEPTED_BACKUP_CODE = /^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/;

describe('two-factor backup code format', () => {
  const trait = new AuthTotpTrait();

  it('generates codes the browser input contract accepts', () => {
    // Generate a wide sample: the alphabet is indexed by random bytes, so a
    // single call can easily miss an offending character.
    const codes = Array.from({ length: 200 }, () => trait.generateBackupCodes()).flat();
    expect(codes.length).toBeGreaterThan(500);
    for (const code of codes) {
      expect(code).toMatch(WEB_ACCEPTED_BACKUP_CODE);
    }
  });

  it('never emits visually ambiguous characters', () => {
    const codes = Array.from({ length: 200 }, () => trait.generateBackupCodes()).flat();
    const alphabet = new Set(codes.join('').replace(/-/g, ''));
    // I/O/0/1 are excluded so a transcribed code cannot be misread.
    for (const ambiguous of ['I', 'O', '0', '1']) {
      expect(alphabet.has(ambiguous)).toBe(false);
    }
  });

  it('hashes a backup code case- and whitespace-insensitively', () => {
    const [code] = trait.generateBackupCodes();
    const trait2 = new AuthTotpTrait() as AuthTotpTrait & { totpEncryptionKey: Buffer };
    const key = Buffer.alloc(32, 3);
    (trait as unknown as { totpEncryptionKey: Buffer }).totpEncryptionKey = key;
    trait2.totpEncryptionKey = key;
    // The browser upper-cases and trims before sending, but a user pasting into
    // a client that does not must still recover their account.
    expect(trait2.hashBackupCode(` ${code.toLowerCase()} `)).toBe(trait.hashBackupCode(code));
  });
});
