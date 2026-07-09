import { describe, expect, it } from 'vitest';

import { ctaTextForAd } from '../src/ad-display';

describe('ad display mapping', () => {
  it('uses served advertiser CTA text when present', () => {
    expect(ctaTextForAd({ ctaText: 'Start trial' })).toBe('Start trial');
  });

  it('falls back to the default CTA when the server omits CTA text', () => {
    expect(ctaTextForAd({ ctaText: null })).toBe('Visit site');
    expect(ctaTextForAd({})).toBe('Visit site');
  });

  it('falls back when CTA text is blank', () => {
    expect(ctaTextForAd({ ctaText: '   ' })).toBe('Visit site');
  });
});
