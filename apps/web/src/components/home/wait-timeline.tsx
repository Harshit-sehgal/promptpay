import { type ColorField, ColorFields } from '@/components/motion/color-fields';
import { Reveal } from '@/components/motion/reveal';

const FIELDS: ColorField[] = [
  { color: 4, size: 460, x: '10%', y: '120px', speed: -0.1 },
  { color: 2, size: 400, x: 'calc(95% - 400px)', y: '220px', speed: 0.06 },
];

const TASK = (
  <>
    <b>claude</b> › fix the flaky checkout test
    <br />
  </>
);

export function WaitTimeline() {
  return (
    <section id="how-it-works" className="home-section">
      <ColorFields fields={FIELDS} />
      <div className="home-inner">
        <div className="moments-head">
          <Reveal as="h2">
            One wait, start
            <br />
            to finish.
          </Reveal>
          <Reveal as="p" className="home-lede" delayIndex={1}>
            The card only exists while your agent works. Nothing shows up while you type or read
            code.
          </Reveal>
        </div>
        <div className="moments">
          <Reveal className="moment glass" delayIndex={0}>
            <div className="moment__time">
              <span className="home-clock">0:00</span>
            </div>
            <div className="moment__window">
              {TASK}
              Working…
            </div>
            <p>You hand your agent a task and wait.</p>
          </Reveal>
          <Reveal className="moment glass" delayIndex={1}>
            <div className="moment__time">
              <span className="home-clock">0:01</span>
            </div>
            <div className="moment__window">
              {TASK}
              Running tests…
              <div className="home-card moment__card">
                <strong>Tidewater CI</strong>
                2,000 free build minutes
              </div>
            </div>
            <p>One labelled card appears. Close it any time.</p>
          </Reveal>
          <Reveal className="moment glass" delayIndex={2}>
            <div className="moment__time">
              <span className="home-clock">0:12</span>
            </div>
            <div className="moment__window">
              {TASK}
              <span className="moment__ok">✓</span> Done. 3 files changed.
            </div>
            <p>Your agent finishes. The card is gone.</p>
          </Reveal>
        </div>
      </div>
    </section>
  );
}
