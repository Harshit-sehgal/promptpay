import { createRequire } from 'module';
import { describe, expect, it } from 'vitest';

// A-018 CSP / security-header regression lock.
//
// Asserts that the headers applied to app routes (via next.config.js
// `headers()`) contain the security posture the A-018 fix established:
// a correctly-shaped CSP plus the supporting hardening headers.
//
// The test loads the exported Next.js config and awaits its async
// `headers()` so it reflects exactly what ships — no browser required.

const require = createRequire(import.meta.url);

type HeaderConfig = {
  key: string;
  value: string;
};
type RouteConfig = { headers: HeaderConfig[] };

async function loadHeaders(): Promise<HeaderConfig[]> {
  const config = require('../next.config.js') as {
    headers: () => Promise<RouteConfig[]>;
  };
  // `headers()` is an async function returning the route→headers map.
  const routes = await config.headers();
  return routes.flatMap((route) => route.headers);
}

describe('Web security headers (A-018 contract)', () => {
  it('exposes the CSP and hardening headers on matched app routes', async () => {
    const headers = await loadHeaders();
    const byKey = new Map(headers.map((h) => [h.key.toLowerCase(), h.value]));

    // Every expected header key must be present.
    expect(byKey.has('content-security-policy')).toBe(true);
    expect(byKey.has('x-content-type-options')).toBe(true);
    expect(byKey.has('x-frame-options')).toBe(true);
    expect(byKey.has('referrer-policy')).toBe(true);
    expect(byKey.has('permissions-policy')).toBe(true);
    expect(byKey.has('strict-transport-security')).toBe(true);

    const csp = byKey.get('content-security-policy')!;

    // (a) CSP directives required by the A-018 contract.
    expect(csp).toContain("script-src 'self' 'unsafe-inline'");
    expect(csp).toContain("frame-src 'self' https://accounts.google.com");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("base-uri 'self'");
    expect(csp).toContain("form-action 'self'");

    // (b) Supporting hardening headers.
    expect(byKey.get('x-content-type-options')).toBe('nosniff');
    expect(byKey.get('x-frame-options')).toBe('DENY');
  });

  it('applies headers to a non-Next.js app route source pattern', async () => {
    const config = require('../next.config.js') as {
      headers: () => Promise<RouteConfig[]>;
    };
    const routes = await config.headers();
    // The single route matches every path except Next.js internals.
    expect(routes).toHaveLength(1);
    expect(routes[0]).toMatchObject({ source: '/((?!_next).*)' });
    expect(routes[0].headers.length).toBeGreaterThan(0);
  });
});
