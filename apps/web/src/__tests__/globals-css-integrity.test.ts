import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { PALETTES } from '../lib/palette';

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
    // Fonts are self-hosted through `next/font/local` in `layout.tsx` (Inter Tight,
    // Geist, Geist Mono). A remote `@import url(fonts.googleapis…)`
    // would add a render-blocking third-party request the build cannot control.
    expect(css).toMatch(/@import ['"]tailwindcss['"];/);
    expect(css).not.toMatch(/@import\s+url\(/);
  });

  it('wires the three self-hosted families used by the design system', () => {
    // The failure mode this guards: font classes shipped while the face was
    // never loaded, so text silently fell back to a system font.
    const layout = readFileSync(join(__dirname, '..', 'app', 'layout.tsx'), 'utf8');
    for (const file of ['inter-tight-var.ttf', 'geist-var.ttf', 'geist-mono-var.ttf']) {
      expect(layout).toContain(file);
    }
    for (const v of ['--font-display', '--font-ui', '--font-utility']) {
      expect(layout).toContain(v);
    }
    expect(layout).not.toMatch(/instrument-serif|jetbrains-mono/);
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

  it('keeps dark-mode planner values readable in its light input controls', () => {
    expect(css).toMatch(
      /html\[data-landing-theme='dark'\][\s\S]*\.landing-page \.landing-planner input\s*\{\s*color: #1d2933 !important;/,
    );
    expect(css).toMatch(
      /html\[data-landing-theme='dark'\][\s\S]*\.landing-planner \.bg-white\s*\{\s*background-color: #ffffff !important;/,
    );
  });

  it('keeps the final component language quiet and two-tone', () => {
    expect(css).toMatch(/--ateva-canvas-final:\s*#ffffff/);
    expect(css).toMatch(/--ateva-action-final:\s*#17191c/);
    expect(css).toMatch(/\.status-badge\s*\{/);
    expect(css).toMatch(/\.status-badge__dot\s*\{/);
    expect(css).toMatch(/\.app-stat-card__value\s*\{/);
    expect(css).toMatch(/\.app-shell \.launch-mode-banner\s*\{/);
  });

  describe('palette token layer', () => {
    const paletteBlock = (id: string) => {
      const blocks = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)];
      const hit = blocks.find(([, selector]) => selector!.includes(`html[data-palette='${id}']`));
      return hit?.[2] ?? '';
    };

    it.each(PALETTES)('defines $id page and --c1 inside its html[data-palette] block', (p) => {
      const block = paletteBlock(p.id);
      expect(block).toContain(`--page: ${p.page}`);
      expect(block).toContain(`--c1: ${p.c[0]}`);
    });

    it('sets color-scheme per palette', () => {
      expect(paletteBlock('midnight')).toMatch(/color-scheme:\s*dark/);
      for (const p of PALETTES.filter((x) => x.id !== 'midnight')) {
        expect(paletteBlock(p.id)).toMatch(/color-scheme:\s*light/);
      }
    });
  });
});
