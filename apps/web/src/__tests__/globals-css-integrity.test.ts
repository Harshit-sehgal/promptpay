import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Structural guards for `globals.css`.
 *
 * A malformed `@import` does not fail `next build` — it emits a warning and
 * carries on, so typecheck, lint, build and every unit test stayed green while
 * the stylesheet was actually invalid and Tailwind's utilities never compiled.
 * The breakage only surfaced in Playwright, as a responsive assertion failing
 * for reasons that looked unrelated to CSS.
 *
 * These assert on the file's structure rather than on a command exiting zero.
 */
const CSS_PATH = join(__dirname, '..', 'app', 'globals.css');
const css = readFileSync(CSS_PATH, 'utf8');

describe('globals.css integrity', () => {
  it('keeps every at-rule statement on a single line', () => {
    // A quoted `;` (Google Fonts sends `wght@400;500;600`) must never be
    // treated as a statement terminator and wrapped onto the next line.
    const broken = css
      .split('\n')
      .map((line, index) => ({ line, number: index + 1 }))
      .filter(({ line }) => {
        const quotes = (line.match(/'/g) ?? []).length + (line.match(/"/g) ?? []).length;
        return line.trimStart().startsWith('@') && quotes % 2 !== 0;
      });

    expect(broken.map((b) => `line ${b.number}: ${b.line.trim()}`)).toEqual([]);
  });

  it('still imports the webfonts and Tailwind', () => {
    expect(css).toMatch(/@import url\('https:\/\/fonts\.googleapis\.com\/css2\?[^\n']+'\);/);
    expect(css).toMatch(/@import ['"]tailwindcss['"];/);
  });

  it('balances every brace', () => {
    let depth = 0;
    let inString = false;
    let quote = '';

    for (const char of css) {
      if (inString) {
        if (char === quote) inString = false;
        continue;
      }
      if (char === "'" || char === '"') {
        inString = true;
        quote = char;
        continue;
      }
      if (char === '{') depth += 1;
      if (char === '}') depth -= 1;
      expect(depth).toBeGreaterThanOrEqual(0);
    }

    expect(depth).toBe(0);
  });

  it('declares the shared nav surface the pages reference', () => {
    // `.glass-nav` shipped on eight pages while declared nowhere, so those
    // navs rendered with no backdrop at all.
    expect(css).toMatch(/\.glass-nav\s*\{/);
  });
});
