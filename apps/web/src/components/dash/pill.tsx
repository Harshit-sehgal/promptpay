import { type ReactNode } from 'react';

export type Tone = 'ok' | 'warn' | 'bad' | 'neutral';

/** A status chip. The tone is the dot; the words stay ink so they keep AA. */
export function Pill({ tone = 'neutral', children }: { tone?: Tone; children: ReactNode }) {
  return (
    <span className="dash-pill" data-tone={tone}>
      <span className="dash-pill__dot" aria-hidden="true" />
      {children}
    </span>
  );
}
