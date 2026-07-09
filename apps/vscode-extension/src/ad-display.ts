export interface ServedAdForDisplay {
  ctaText?: string | null;
}

export function ctaTextForAd(ad: ServedAdForDisplay): string {
  const ctaText = ad.ctaText?.trim();
  return ctaText || 'Visit site';
}
