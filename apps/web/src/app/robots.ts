import type { MetadataRoute } from 'next';

/**
 * robots.txt for the public site. Private/authenticated sections (admin,
 * developer, advertiser dashboards and the auth flows) must never be
 * crawled or indexed; the BFF API routes are intentionally excluded too.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: ['/api/', '/auth/', '/admin/', '/developer/', '/advertiser/'],
    },
    sitemap: undefined,
  };
}
