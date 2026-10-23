import { describe, expect, it } from 'vitest';

import { PALETTES } from './palette';

type Rgb = [number, number, number];

function parseHex(hex: string): Rgb {
  const n = hex.replace('#', '');
  return [0, 2, 4].map((i) => parseInt(n.slice(i, i + 2), 16)) as Rgb;
}

/** Parses the space-separated `rgb(r g b / a)` form used by `Palette.glass`. */
function parseGlass(value: string): { rgb: Rgb; alpha: number } {
  const m = /^rgb\((\d+) (\d+) (\d+) \/ (\.?\d*\.?\d+)\)$/.exec(value);
  if (!m) throw new Error(`Unparseable glass colour: ${value}`);
  return { rgb: [Number(m[1]), Number(m[2]), Number(m[3])], alpha: Number(m[4]) };
}

function composite(top: { rgb: Rgb; alpha: number }, bottom: Rgb): Rgb {
  return top.rgb.map((c, i) => c * top.alpha + bottom[i]! * (1 - top.alpha)) as Rgb;
}

/** WCAG 2.1 relative luminance. */
function relativeLuminance([r, g, b]: Rgb): number {
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

function contrastRatio(a: Rgb, b: Rgb): number {
  const [hi, lo] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
}

describe.each(PALETTES)('palette $id contrast (WCAG AA, 4.5:1)', (p) => {
  const page = parseHex(p.page);
  const glassOnPage = composite(parseGlass(p.glass), page);

  it('copy reads on the page', () => {
    expect(contrastRatio(parseHex(p.copy), page)).toBeGreaterThanOrEqual(4.5);
  });

  it('copy reads on glass', () => {
    expect(contrastRatio(parseHex(p.copy), glassOnPage)).toBeGreaterThanOrEqual(4.5);
  });

  it('quiet reads on glass', () => {
    expect(contrastRatio(parseHex(p.quiet), glassOnPage)).toBeGreaterThanOrEqual(4.5);
  });

  it('the timer chip (page-coloured text on an ink fill) reads', () => {
    expect(contrastRatio(page, parseHex(p.ink))).toBeGreaterThanOrEqual(4.5);
  });
});
