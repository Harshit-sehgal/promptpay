import { createHash } from 'crypto';
import { afterEach, describe, expect, it } from 'vitest';

import { privacyPseudonym } from './privacy-hash';

describe('privacyPseudonym', () => {
  const originalKey = process.env.PRIVACY_HASH_KEY;

  afterEach(() => {
    if (originalKey === undefined) delete process.env.PRIVACY_HASH_KEY;
    else process.env.PRIVACY_HASH_KEY = originalKey;
  });

  it('is deterministic and purpose-separated without retaining raw input', () => {
    process.env.PRIVACY_HASH_KEY = 'privacy-test-key-at-least-32-characters-long';
    const value = '203.0.113.10';
    const first = privacyPseudonym(value, 'audit-ip');
    expect(first).toBe(privacyPseudonym(value, 'audit-ip'));
    expect(first).not.toBe(privacyPseudonym(value, 'feedback-ip'));
    expect(first).not.toContain(value);
    expect(first).not.toBe(createHash('sha256').update(value).digest('hex'));
  });
});
