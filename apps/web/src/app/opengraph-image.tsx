import { ImageResponse } from 'next/og';

export const alt = 'Ateva — private beta for AI wait-state verification';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

/**
 * The social share card.
 *
 * This is the only place the product is rendered for someone who has not
 * visited it yet, and it had drifted furthest: a `W` badge from the pre-rename
 * name, an indigo palette the site does not use anywhere, and a headline
 * ("Verify AI wait states" / "No code tracking") that predates the current
 * positioning. It now carries the same mark, palette and claim as the homepage.
 *
 * Drawn with divs rather than the shared `BrandMark` SVG because this renders
 * through Satori, which supports only a flexbox subset and no CSS classes.
 * Geometry mirrors `components/brand-mark.tsx` at 3.5x the 16px viewBox.
 */
export default function OpengraphImage() {
  const bar = { height: 9, borderRadius: 2, background: 'white' };

  return new ImageResponse(
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        padding: '80px',
        background: 'linear-gradient(135deg, #0a0a0a 0%, #0b1a12 65%, #063a25 100%)',
        color: 'white',
        fontFamily: 'sans-serif',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', fontSize: 40, fontWeight: 700 }}>
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 6,
            width: 56,
            marginRight: 22,
          }}
        >
          <div style={{ ...bar, width: 56 }} />
          <div style={{ ...bar, width: 56 }} />
          <div style={{ ...bar, width: 39, background: '#4ade80' }} />
        </div>
        Ateva
      </div>

      <div style={{ fontSize: 62, fontWeight: 800, marginTop: 44, lineHeight: 1.12 }}>
        Verify AI-agent wait time
      </div>
      <div style={{ fontSize: 62, fontWeight: 800, lineHeight: 1.12, color: '#4ade80' }}>
        without reading the work.
      </div>

      <div style={{ fontSize: 28, marginTop: 34, opacity: 0.82, lineHeight: 1.4 }}>
        No source code, prompts, or terminal output.
      </div>
      <div style={{ fontSize: 22, marginTop: 18, opacity: 0.6, letterSpacing: 1 }}>
        Private beta · rewards disabled
      </div>
    </div>,
    size,
  );
}
