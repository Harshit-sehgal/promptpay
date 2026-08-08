import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const APP_DIR = resolve(__dirname);

/**
 * Every route must resolve a real browser title.
 *
 * 37 of ~44 pages shipped without any metadata of their own. All of them are
 * Client Components, and a Client Component cannot export `metadata`, so each
 * one silently inherited the root layout's marketing string — every tab, every
 * bookmark and every shared link read
 * "WaitLayer — private beta for AI wait-state verification".
 *
 * A title comes from the page itself or from any `layout.tsx` between it and
 * the app root. This walks that chain the way Next.js does, so the check
 * cannot be satisfied by a file that Next would never consult.
 */

function pages(dir = APP_DIR, prefix = ''): { route: string; file: string }[] {
  const out: { route: string; file: string }[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      const segment = /^[([_]/.test(entry) ? '' : `/${entry}`;
      out.push(...pages(full, prefix + segment));
    } else if (entry === 'page.tsx') {
      out.push({ route: prefix === '' ? '/' : prefix, file: full });
    }
  }
  return out;
}

const definesTitle = (file: string) => {
  const src = readFileSync(file, 'utf8');
  return /export\s+(const\s+metadata|async\s+function\s+generateMetadata|function\s+generateMetadata)/.test(
    src,
  );
};

/**
 * Walk from the page up to the app root, as Next.js resolves metadata — but
 * STOP BEFORE the root layout.
 *
 * The root layout always defines metadata, so including it made this check
 * vacuous: every route "resolved a title" no matter what, and deleting a
 * page's own metadata layout still passed. Excluding it is what makes the
 * assertion mean "this route has a title of its own", which is the actual
 * requirement. `/` is the one legitimate exception — the root title is written
 * for the home page.
 */
function resolvesTitle(pageFile: string): boolean {
  if (definesTitle(pageFile)) return true;
  let dir = dirname(pageFile);
  while (resolve(dir) !== APP_DIR) {
    const layout = join(dir, 'layout.tsx');
    try {
      if (statSync(layout).isFile() && definesTitle(layout)) return true;
    } catch {
      /* no layout at this level */
    }
    dir = dirname(dir);
  }
  return false;
}

describe('page metadata', () => {
  it('every route resolves a title from its own metadata or a layout above it', () => {
    const missing = pages()
      // `/` legitimately takes its title from the root layout.
      .filter(({ route }) => route !== '/')
      .filter(({ file }) => !resolvesTitle(file))
      .map(({ route }) => route);
    expect(
      missing,
      `routes with no title anywhere in their layout chain: ${missing.join(', ')}`,
    ).toEqual([]);
  });

  it('authenticated shells are marked noindex in metadata, not only in robots.txt', () => {
    // robots.txt is a request, not an enforcement, and it only covers crawlers
    // that read it. The meta tag travels with the page.
    for (const segment of ['admin', 'advertiser', 'developer']) {
      const src = readFileSync(join(APP_DIR, segment, 'layout.tsx'), 'utf8');
      expect(src, `${segment} shell must set robots.index = false`).toMatch(
        /robots:\s*\{[^}]*index:\s*false/,
      );
    }
  });

  it('dashboard shells stay Server Components so they can carry metadata', () => {
    // These layouts have no hooks and no event handlers. If someone adds
    // `'use client'` back, `metadata` is silently ignored and every page
    // beneath inherits the marketing title again — with no error to notice.
    for (const segment of ['admin', 'advertiser', 'developer']) {
      const src = readFileSync(join(APP_DIR, segment, 'layout.tsx'), 'utf8');
      expect(
        src.startsWith("'use client'"),
        `${segment}/layout.tsx must stay a Server Component`,
      ).toBe(false);
      expect(src).toMatch(/export const metadata/);
    }
  });
});
