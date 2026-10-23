import { ImageResponse } from 'next/og';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

export const alt = 'Ateva — delivery verification for AI-agent apps';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

/**
 * The social share card.
 *
 * Rendered on paper white: heavy Inter Tight display type, a single Blush
 * Peach chip, and the three-bar mark.
 * This mirrors the palette and claim of the homepage rather than inventing its
 * own visual language.
 *
 * Drawn with divs rather than the shared `BrandMark` SVG because this renders
 * through Satori, which supports only a flexbox subset and no CSS classes.
 * The display face is read from `public/fonts` and passed explicitly — Satori
 * has no access to `next/font`, and its font parser rejects variable fonts, so
 * this loads a static ExtraBold instance cut from `inter-tight-var.ttf`.
 */
export default async function OpengraphImage() {
  const fontsDir = path.join(process.cwd(), 'public', 'fonts');
  const display = await readFile(path.join(fontsDir, 'inter-tight-800.ttf'));

  const bar = { height: 10, borderRadius: 3, background: '#17191c' };

  return new ImageResponse(
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        padding: '72px 80px',
        background: '#ffffff',
        color: '#17191c',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', fontSize: 34 }}>
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 7,
            width: 54,
            marginRight: 20,
          }}
        >
          <div style={{ ...bar, width: 54 }} />
          <div style={{ ...bar, width: 54 }} />
          <div style={{ ...bar, width: 37, background: '#fbe1d1' }} />
        </div>
        Ateva
      </div>

      <div style={{ display: 'flex', flexDirection: 'column' }}>
        <div
          style={{
            fontFamily: 'Inter Tight',
            fontWeight: 800,
            fontSize: 88,
            lineHeight: 1.08,
            letterSpacing: -2,
            display: 'flex',
          }}
        >
          Your agent has been working for 0:05.
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ fontSize: 26, color: '#5f636e' }}>
          No source code, prompts, or terminal output.
        </div>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            background: '#fbe1d1',
            color: '#4a2113',
            borderRadius: 999,
            padding: '12px 24px',
            fontSize: 22,
          }}
        >
          Private beta · rewards disabled
        </div>
      </div>
    </div>,
    {
      ...size,
      fonts: [{ name: 'Inter Tight', data: display, weight: 800, style: 'normal' }],
    },
  );
}
