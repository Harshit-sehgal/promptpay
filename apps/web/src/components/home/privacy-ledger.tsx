import Link from 'next/link';
import { type CSSProperties } from 'react';
import { type ColorField, ColorFields } from '@/components/motion/color-fields';
import { Reveal } from '@/components/motion/reveal';

const FIELDS: ColorField[] = [
  { color: 3, size: 480, x: 'calc(100% - 480px)', y: '80px', speed: -0.08 },
];

const SENT = [
  'A wait started',
  'Which tool it was',
  'The card was shown',
  'For how long',
  'Your country (from the system locale)',
  'Session and device IDs',
];

const NEVER_SENT = ['Your prompts', 'Your code', 'Terminal output', 'File and repo names'];

export function PrivacyLedger() {
  return (
    <section id="privacy" className="home-section">
      <ColorFields fields={FIELDS} />
      <div className="home-inner">
        <Reveal as="h2">Here&apos;s everything we see.</Reveal>
        <div className="ledger">
          <Reveal className="ledger__panel glass" delayIndex={0}>
            <h3>Sent to Ateva</h3>
            <ul>
              {SENT.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </Reveal>
          {/* Each line is struck through once the panel's reveal lands. */}
          <Reveal className="ledger__panel ledger__panel--never glass" delayIndex={1}>
            <h3>Never sent</h3>
            <ul>
              {NEVER_SENT.map((item, index) => (
                <li key={item}>
                  <span className="strike" style={{ '--j': index } as CSSProperties}>
                    {item}
                  </span>
                </li>
              ))}
            </ul>
          </Reveal>
        </div>
        <Reveal as="p" className="ledger__note" delayIndex={2}>
          Full detail, including consent and request IDs, is in the{' '}
          <Link href="/privacy">privacy policy</Link>.
        </Reveal>
      </div>
    </section>
  );
}
