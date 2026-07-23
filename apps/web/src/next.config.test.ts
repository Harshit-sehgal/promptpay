import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { buildCsp } from './lib/csp.js';

// A-018: Google Identity Services (GIS) renders its account-picker popup and
// One-Tap prompt inside a cross-origin iframe at accounts.google.com, and it
// loads its bootstrap script from accounts.google.com/gsi/client. Both must be
// present in the production CSP or Google sign-in cannot complete under CSP.

function parseDirectives(csp: string): Record<string, string> {
  return csp.split(';').reduce<Record<string, string>>((acc, directive) => {
    const trimmed = directive.trim();
    if (!trimmed) return acc;
    const idx = trimmed.indexOf(' ');
    const name = idx === -1 ? trimmed : trimmed.slice(0, idx);
    const value = idx === -1 ? '' : trimmed.slice(idx + 1).trim();
    acc[name] = value;
    return acc;
  }, {});
}

async function getHeaders() {
  const config = await import('../next.config.js');
  return config.default.headers as () => Promise<
    Array<{ source: string; headers: Array<{ key: string; value: string }> }>
  >;
}

describe('Google sign-in CSP (A-018)', () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('defines a frame-src directive allowing the Google accounts origin', () => {
    vi.stubEnv('NODE_ENV', 'production');
    const dirs = parseDirectives(buildCsp());
    expect(dirs['frame-src']).toContain('https://accounts.google.com');
  });

  it('defines a script-src directive allowing the Google gsi/client bootstrap', () => {
    vi.stubEnv('NODE_ENV', 'production');
    const dirs = parseDirectives(buildCsp());
    expect(dirs['script-src']).toContain('https://accounts.google.com/gsi/client');
  });

  it("adds 'unsafe-eval' in development for React Fast Refresh", () => {
    vi.stubEnv('NODE_ENV', 'development');
    const dirs = parseDirectives(buildCsp());
    expect(dirs['script-src']).toContain("'unsafe-eval'");
  });

  it("does not include 'unsafe-eval' in production", () => {
    vi.stubEnv('NODE_ENV', 'production');
    const dirs = parseDirectives(buildCsp());
    expect(dirs['script-src']).not.toContain("'unsafe-eval'");
  });

  it('wires the Content-Security-Policy header into the response headers', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    const headersFn = await getHeaders();
    const headerRules = await headersFn();
    const csp = headerRules
      .flatMap((rule) => rule.headers)
      .find((h) => h.key === 'Content-Security-Policy')?.value;
    expect(csp).toBeDefined();
    const dirs = parseDirectives(csp!);
    expect(dirs['frame-src']).toContain('https://accounts.google.com');
    expect(dirs['script-src']).toContain('https://accounts.google.com/gsi/client');
    expect(dirs['script-src']).not.toContain("'unsafe-eval'");

    // The emitted CSP must be exactly what buildCsp() produces in production so
    // that the response-header wiring cannot drift from the source of truth.
    expect(csp).toBe(buildCsp());
  });
});
