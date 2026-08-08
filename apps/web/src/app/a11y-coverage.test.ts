import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const APP_DIR = resolve(__dirname);
const A11Y_SPEC = resolve(__dirname, '../../e2e/a11y.spec.ts');

/**
 * The accessibility sweep must cover every public page.
 *
 * `a11y.spec.ts` hard-codes the paths it scans, and that list had fallen 8
 * pages behind — including all three `/legal/*` documents and both policy
 * pages. Nothing failed, because a hard-coded list cannot notice what is not
 * in it. This derives the expectation from the filesystem instead, which is
 * the same fix applied to the sitemap after it rotted the same way.
 *
 * Authenticated pages are deliberately out of scope: they are covered by the
 * component suites and the smoke E2E, and axe cannot reach them without a
 * logged-in session. That exclusion is asserted rather than assumed, so
 * "public" cannot quietly come to mean something else.
 */

const PRIVATE_PREFIXES = ['/admin', '/advertiser/', '/developer'];

function publicRoutes(dir = APP_DIR, prefix = ''): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      const segment = /^[([_]/.test(entry) ? '' : `/${entry}`;
      out.push(...publicRoutes(full, prefix + segment));
    } else if (entry === 'page.tsx') {
      out.push(prefix === '' ? '/' : prefix);
    }
  }
  return out.filter(
    (r) => !PRIVATE_PREFIXES.some((p) => r === p.replace(/\/$/, '') || r.startsWith(p)),
  );
}

/** Paths listed in the a11y spec, with any query string stripped. */
function scannedPaths(): string[] {
  const src = readFileSync(A11Y_SPEC, 'utf8');
  const block = /const PAGES = \[(.*?)\];/s.exec(src);
  if (!block) throw new Error('could not find the PAGES list in a11y.spec.ts');
  return [...block[1].matchAll(/'([^']+)'/g)].map(([, p]) => p.replace(/\?.*$/, ''));
}

describe('accessibility coverage', () => {
  it('scans every public page', () => {
    const scanned = new Set(scannedPaths());
    const missing = publicRoutes().filter((r) => !scanned.has(r));
    expect(missing, `public pages not covered by the a11y sweep: ${missing.join(', ')}`).toEqual(
      [],
    );
  });

  it('does not list a page that no longer exists', () => {
    const real = new Set(publicRoutes());
    // Auth routes are public in the crawl sense — reachable without a session —
    // and are legitimately scanned, so allow them explicitly.
    const dangling = scannedPaths().filter((p) => !real.has(p) && !p.startsWith('/auth/'));
    expect(dangling, `a11y sweep points at missing routes: ${dangling.join(', ')}`).toEqual([]);
  });

  it('guards the guard — the parse must actually find paths', () => {
    // A regex that silently matched nothing would make both assertions above
    // pass forever.
    expect(scannedPaths().length).toBeGreaterThan(10);
    expect(scannedPaths()).toContain('/');
  });
});
