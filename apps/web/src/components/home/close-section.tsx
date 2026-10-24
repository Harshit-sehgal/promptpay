import { Reveal } from '@/components/motion/reveal';

import { CloseClock } from './hero';
import { HomeAction } from './home-action';

export function CloseSection() {
  return (
    <section id="get-started" className="home-close">
      <div className="home-inner">
        <Reveal className="close-panel glass">
          <h2>
            Your next wait could be <CloseClock /> well spent.
          </h2>
          <div className="close-action">
            <HomeAction placement="close" />
          </div>
        </Reveal>
        <p className="home-fine">
          Private beta: measuring delivery only. No rewards and no campaign billing yet. Tidewater
          CI is an example sponsor.
        </p>
      </div>
    </section>
  );
}
