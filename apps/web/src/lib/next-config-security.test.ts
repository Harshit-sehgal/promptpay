import { createRequire } from 'module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);

describe('Next.js security policy', () => {
  it('pins built assets and disables inline script attributes without breaking bootstrap hydration', async () => {
    const config = require('../../next.config.js') as {
      crossOrigin?: string;
      experimental?: { sri?: { algorithm?: string } };
      headers: () => Promise<Array<{ headers: Array<{ key: string; value: string }> }>>;
    };
    const routes = await config.headers();
    const csp = routes
      .flatMap((route) => route.headers)
      .find((header) => header.key === 'Content-Security-Policy')?.value;

    expect(config.crossOrigin).toBe('anonymous');
    expect(config.experimental?.sri?.algorithm).toBe('sha384');
    expect(csp).toContain("script-src-attr 'none'");
    expect(csp).toContain("frame-ancestors 'none'");
    // Next's static bootstrap is not nonce-stamped; this compatibility token
    // remains deliberate until every protected page is dynamically rendered.
    expect(csp).toContain("script-src 'self' 'unsafe-inline'");
  });
});
