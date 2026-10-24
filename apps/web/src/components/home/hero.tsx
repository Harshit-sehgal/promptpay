'use client';

import { type CSSProperties, Fragment, useEffect, useState } from 'react';
import { type ColorField, ColorFields } from '@/components/motion/color-fields';

import { clockFrame, SSR_CLOSE_SECOND, SSR_HERO_SECOND } from './clock';
import { HomeAction } from './home-action';

const HERO_FIELDS: ColorField[] = [
  { color: 1, size: 520, x: 'calc(100% - 440px)', y: '40px', speed: -0.12 },
  { color: 3, size: 380, x: 'calc(100% - 680px)', y: '280px', speed: 0.08 },
  { color: 2, size: 300, x: '-100px', y: '-60px', speed: -0.05 },
];

const HEADLINE_WORDS = ['Your', 'agent', 'has', 'been', 'working', 'for'];

/* Returns a tick that starts at `startAt` (what the server rendered) and
   advances once a second after mount. It stops while the tab is hidden and
   carries on from the same tick when it comes back, with no catch-up. */
export function useClock(startAt: number): number {
  const [tick, setTick] = useState(startAt);

  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | undefined;
    const start = () => {
      timer ??= setInterval(() => setTick((value) => value + 1), 1000);
    };
    const stop = () => {
      clearInterval(timer);
      timer = undefined;
    };
    const onVisibilityChange = () => (document.visibilityState === 'hidden' ? stop() : start());

    if (document.visibilityState !== 'hidden') start();
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      stop();
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, []);

  return tick;
}

/* The live timer chip inside a headline. A ticking heading would be
   re-announced every second, so assistive tech reads a static phrase instead. */
function ClockChip({ label }: { label: string }) {
  return (
    <>
      <span className="home-clock" aria-hidden="true">
        {label}
      </span>
      <span className="sr-only">a few seconds</span>
    </>
  );
}

const word = (index: number) => ({ '--w': index }) as CSSProperties;

export function Hero() {
  const frame = clockFrame(useClock(SSR_HERO_SECOND));

  return (
    <section className="home-hero">
      <ColorFields fields={HERO_FIELDS} />
      <div className="home-inner hero-grid">
        <div>
          <h1 className="hero-title">
            {HEADLINE_WORDS.map((text, index) => (
              <Fragment key={text}>
                <span className="hero-word" style={word(index)}>
                  {text}
                </span>{' '}
              </Fragment>
            ))}
            <span className="hero-word" style={word(HEADLINE_WORDS.length)}>
              <ClockChip label={frame.label} />
            </span>
            <span className="hero-word" style={word(HEADLINE_WORDS.length + 1)}>
              .
            </span>
          </h1>
          <p className="home-lede hero-lede">
            That wait is where Ateva shows one small sponsored card. Nothing you type is sent.
          </p>
          <div className="hero-actions">
            <HomeAction placement="hero" />
          </div>
        </div>
        <div className="hero-stage">
          <div className="agent glass">
            <b>claude</b> › fix the flaky checkout test
            <br />
            <span className={frame.done ? 'agent-status is-done' : 'agent-status'} aria-live="off">
              {frame.status}
            </span>
          </div>
          <div
            className={
              frame.cardVisible
                ? 'home-card hero-card glass is-visible'
                : 'home-card hero-card glass'
            }
            aria-hidden={!frame.cardVisible}
          >
            <strong>Tidewater CI</strong>
            2,000 free build minutes a month for open-source repos.
            <div className="home-card__row">
              <span>Sponsored — wait state detected</span>
              <span aria-hidden="true">✕</span>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

/* The closing headline's timer: the same clock, two seconds ahead of the hero
   as in the server render. */
export function CloseClock() {
  return <ClockChip label={clockFrame(useClock(SSR_CLOSE_SECOND)).label} />;
}
