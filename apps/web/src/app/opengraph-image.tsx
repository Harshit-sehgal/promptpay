import { ImageResponse } from 'next/og';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

export const alt = 'Ateva — private beta for AI wait-state verification';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

/**
 * The social share card.
 *
 * Rendered as an editorial spread on paper white: serif display type with one
 * italicized sienna phrase, a single Blush Peach chip, and the three-bar mark.
 * This mirrors the palette and claim of the homepage rather than inventing its
 * own visual language.
 *
 * Drawn with divs rather than the shared `BrandMark` SVG because this renders
 * through Satori, which supports only a flexbox subset and no CSS classes.
 * The serif faces are read from `public/fonts` and passed explicitly — Satori
 * has no access to `next/font`.
 */
export default async function OpengraphImage() {
  const fontsDir = path.join(process.cwd(), 'public', 'fonts');
  const [serifRegular, serifItalic] = await Promise.all([
    readFile(path.join(fontsDir, 'instrument-serif-400.ttf')),
    readFile(path.join(fontsDir, 'instrument-serif-400-italic.ttf')),
  ]);

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
            fontFamily: 'Instrument Serif',
            fontSize: 88,
            lineHeight: 1.08,
            letterSpacing: -2,
            display: 'flex',
          }}
        >
          Verify AI-agent wait time
        </div>
        <div
          style={{
            fontFamily: 'Instrument Serif',
            fontStyle: 'italic',
            fontSize: 88,
            lineHeight: 1.08,
            letterSpacing: -2,
            color: '#5d2a1a',
            display: 'flex',
          }}
        >
          without reading the work.
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
      fonts: [
        { name: 'Instrument Serif', data: serifRegular, weight: 400, style: 'normal' },
        { name: 'Instrument Serif', data: serifItalic, weight: 400, style: 'italic' },
      ],
    },
  );
}
