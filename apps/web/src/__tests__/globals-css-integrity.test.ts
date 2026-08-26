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

  it('imports Tailwind and pulls no webfont from a third party', () => {
    // Fonts are self-hosted through `next/font/local` in `layout.tsx` (Inter,
    // JetBrains Mono, Instrument Serif). A remote `@import url(fonts.googleapis…)`
    // would add a render-blocking third-party request the build cannot control.
    expect(css).toMatch(/@import ['"]tailwindcss['"];/);
    expect(css).not.toMatch(/@import\s+url\(/);
  });

  it('has the serif wired as a local font, not merely referenced', () => {
    // The failure mode this guards: `font-serif` classes shipped while the face
    // was never loaded, so headings silently fell back to Georgia.
    const layout = readFileSync(join(__dirname, '..', 'app', 'layout.tsx'), 'utf8');
    expect(layout).toMatch(/instrument-serif-400\.ttf/);
    expect(layout).toMatch(/--font-serif/);
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

  it('keeps public navigation in the shared translucent header', () => {
    const header = readFileSync(join(__dirname, '..', 'components', 'site-header.tsx'), 'utf8');
    expect(header).toMatch(/aria-label="Primary navigation"/);
    expect(header).toMatch(/backdrop-blur-xl/);
  });
});
