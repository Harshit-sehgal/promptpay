import { ImageResponse } from 'next/og';

export const alt = 'WaitLayer — Earn from AI wait time';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          padding: '80px',
          background: 'linear-gradient(135deg, #0f172a 0%, #1e293b 60%, #4f46e5 100%)',
          color: 'white',
          fontFamily: 'sans-serif',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', fontSize: 40, fontWeight: 700 }}>
          <div
            style={{
              width: 56,
              height: 56,
              borderRadius: 12,
              background: '#6366f1',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              marginRight: 20,
              fontSize: 28,
            }}
          >
            W
          </div>
          WaitLayer
        </div>
        <div style={{ fontSize: 68, fontWeight: 800, marginTop: 40, lineHeight: 1.1 }}>
          Earn from AI
        </div>
        <div style={{ fontSize: 68, fontWeight: 800, lineHeight: 1.1, color: '#a5b4fc' }}>
          wait time.
        </div>
        <div style={{ fontSize: 30, marginTop: 32, opacity: 0.85 }}>
          Privacy-first payouts for developers. No code tracking.
        </div>
      </div>
    ),
    size,
  );
}
