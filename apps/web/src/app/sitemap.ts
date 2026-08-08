import type { MetadataRoute } from 'next';

/**
 * Sitemap for the PUBLIC site only.
 *
 * This replaces a hand-maintained `public/sitemap.xml` that had drifted badly:
 * it listed 5 URLs while 12 public pages had shipped without ever being added.
 * A static file in `public/` is also served ahead of the App Router, so it
 * silently won over `robots.ts` — which is why the disallow rules for
 * `/admin/`, `/developer/`, `/advertiser/` and `/auth/` were never actually
 * served to crawlers. Both static files are gone; these routes are generated.
 *
 * Authenticated surfaces are deliberately absent, and `sitemap.test.ts` fails
 * the build if any of them appear here or if a public page is missing — the
 * drift that made the old file useless cannot happen silently again.
 */

/** Only pages that are safe to index. Never add an authenticated route. */
const PUBLIC_ROUTES = [
  { path: '/', priority: 1.0, changeFrequency: 'weekly' as const },
  { path: '/pricing', priority: 0.9, changeFrequency: 'weekly' as const },
  { path: '/comparison', priority: 0.8, changeFrequency: 'monthly' as const },
  { path: '/manifesto', priority: 0.7, changeFrequency: 'monthly' as const },
  { path: '/faq', priority: 0.7, changeFrequency: 'monthly' as const },
  { path: '/security', priority: 0.7, changeFrequency: 'monthly' as const },
  { path: '/changelog', priority: 0.6, changeFrequency: 'weekly' as const },
  { path: '/status', priority: 0.5, changeFrequency: 'daily' as const },
  { path: '/contact', priority: 0.5, changeFrequency: 'yearly' as const },
  { path: '/feedback', priority: 0.4, changeFrequency: 'yearly' as const },
  { path: '/terms', priority: 0.3, changeFrequency: 'yearly' as const },
  { path: '/privacy', priority: 0.3, changeFrequency: 'yearly' as const },
  { path: '/payout-policy', priority: 0.3, changeFrequency: 'yearly' as const },
  { path: '/advertiser-policy', priority: 0.3, changeFrequency: 'yearly' as const },
  { path: '/legal/cookie-policy', priority: 0.2, changeFrequency: 'yearly' as const },
  { path: '/legal/data-retention', priority: 0.2, changeFrequency: 'yearly' as const },
  { path: '/legal/gdpr-dpa', priority: 0.2, changeFrequency: 'yearly' as const },
];

export const SITEMAP_ROUTES = PUBLIC_ROUTES;

export function siteUrl(): string {
  // Same source as `metadataBase` in the root layout, so absolute URLs in the
  // sitemap and the OpenGraph tags can never disagree about the origin.
  return (process.env.NEXT_PUBLIC_WEB_URL ?? 'https://waitlayer.com').replace(/\/$/, '');
}

export default function sitemap(): MetadataRoute.Sitemap {
  const base = siteUrl();
  const lastModified = new Date();
  return PUBLIC_ROUTES.map(({ path, priority, changeFrequency }) => ({
    url: `${base}${path}`,
    lastModified,
    changeFrequency,
    priority,
  }));
}
