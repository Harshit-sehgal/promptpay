import type { MetadataRoute } from 'next';

import { siteUrl } from './sitemap';

/**
 * robots.txt for the public site. Private/authenticated sections (admin,
 * developer, advertiser dashboards and the auth flows) must never be
 * crawled or indexed; the BFF API routes are intentionally excluded too.
 *
 * This file used to be dead. A static `public/robots.txt` said `Allow: /` with
 * no disallow rules at all, and files in `public/` are served ahead of the App
 * Router — so every rule below was written, reviewed, and never served. The
 * static file has been deleted. `robots.test.ts` asserts it stays deleted.
 *
 * Note the trailing slashes: `/advertiser/` blocks the dashboard without
 * blocking the public `/advertiser-policy` page.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: ['/api/', '/auth/', '/admin/', '/developer/', '/advertiser/'],
    },
    sitemap: `${siteUrl()}/sitemap.xml`,
  };
}
