import Link from 'next/link';
import { type ColorField, ColorFields } from '@/components/motion/color-fields';
import { Reveal } from '@/components/motion/reveal';

const FIELDS: ColorField[] = [
  { color: 1, size: 440, x: 'calc(94% - 440px)', y: '40px', speed: -0.1 },
  { color: 4, size: 320, x: '20%', y: 'calc(100% - 260px)', speed: 0.05 },
];

export function SponsorsSection() {
  return (
    <section id="sponsors" className="home-section">
      <ColorFields fields={FIELDS} />
      <div className="home-inner sponsors-grid">
        <div>
          <Reveal as="h2">Reach developers while their agent works.</Reveal>
          <Reveal as="p" className="home-lede" delayIndex={1}>
            One card per wait, clearly labelled, counted only once it has actually been on screen.
            Founding sponsors can join the waitlist now. Nothing is billed during the beta.
          </Reveal>
          <Reveal className="sponsors-action" delayIndex={2}>
            <Link className="home-btn" href="/advertisers">
              Join the sponsor waitlist
            </Link>
          </Reveal>
        </div>
        <div className="slots">
          <Reveal className="home-card glass" delayIndex={1}>
            <strong>Tidewater CI</strong>
            2,000 free build minutes a month for open-source repos.
            <div className="home-card__row">
              <span>Sponsored · on screen 5.2s</span>
            </div>
          </Reveal>
          <Reveal className="home-card slots__empty" delayIndex={2}>
            <strong>Your product</strong>
            One line, one link, one clear label.
          </Reveal>
        </div>
      </div>
    </section>
  );
}
