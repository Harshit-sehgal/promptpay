import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The dashboards' plain light/dark tokens (`--app-*`) must keep every text
 * level at WCAG AA on every surface the app shell paints, and the refine layer
 * must read them rather than carry its own copy of the colours.
 */
const css = readFileSync(join(__dirname, '..', 'app', 'globals.css'), 'utf8');

type Rgb = [number, number, number];

/** The declarations of the first rule, after `from`, that declares `--name`. */
function blockDeclaring(name: string, from = 0): string {
  const at = css.indexOf(`--${name}:`, from);
  if (at < 0) throw new Error(`--${name} not declared`);
  return css.slice(css.lastIndexOf('{', at), css.indexOf('}', at));
}

function token(decls: string, name: string): string {
  const m = new RegExp(`--${name}:\\s*([^;]+);`).exec(decls);
  if (!m) throw new Error(`--${name} not declared`);
  return m[1]!.trim();
}

function parseHex(hex: string): Rgb {
  if (!/^#[0-9a-f]{6}$/i.test(hex)) throw new Error(`Not a 6-digit hex: ${hex}`);
  return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as Rgb;
}

function luminance([r, g, b]: Rgb): number {
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

function contrast(a: Rgb, b: Rgb): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
}

const MODES = [
  { mode: 'light', decls: blockDeclaring('app-canvas') },
  { mode: 'dark', decls: blockDeclaring('app-canvas', css.indexOf('html.dark {')) },
];
const TEXT = ['app-ink', 'app-copy', 'app-muted', 'app-tertiary', 'app-danger'];
const SURFACES = ['app-canvas', 'app-surface', 'app-subtle', 'app-nested'];

describe.each(MODES)('dashboard tokens ($mode)', ({ decls }) => {
  it.each(TEXT.flatMap((t) => SURFACES.map((s) => [t, s])))(
    '%s on %s reaches 4.5:1',
    (text, surface) => {
      const ratio = contrast(parseHex(token(decls, text)), parseHex(token(decls, surface)));
      expect(ratio).toBeGreaterThanOrEqual(4.5);
    },
  );
});

describe.each([
  {
    layer: 'refine',
    token: (n: string) => `ateva-refine-${n}`,
    names: ['canvas', 'surface', 'subtle', 'inset', 'ink', 'copy', 'muted', 'line'],
  },
  {
    layer: 'final',
    token: (n: string) => `ateva-${n}-final`,
    names: ['canvas', 'surface', 'subtle', 'nested', 'ink', 'copy', 'muted', 'faint', 'line'],
  },
])('$layer layer', ({ token: name, names }) => {
  it('reads the dashboard tokens instead of its own colours', () => {
    const decls = blockDeclaring(name('canvas'));
    for (const n of names) expect(token(decls, name(n))).toMatch(/^var\(--app-[a-z-]+\)$/);
    expect(css).not.toMatch(new RegExp(`--${name('canvas')}:\\s*#`));
  });
});
