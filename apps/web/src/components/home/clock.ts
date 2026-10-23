/* One clock drives the hero: it counts 0:00 to 0:12, holds for three seconds
   and loops. The agent status and the sponsored card are derived from the same
   tick so the three never fall out of step. */

export const CLOCK_PERIOD = 16;
/** The tick the hero renders on the server and before hydration. */
export const SSR_HERO_SECOND = 5;
/** The tick the closing headline renders on the server and before hydration. */
export const SSR_CLOSE_SECOND = 7;

const LAST_SECOND = 12;
const STATUSES = ['Working', 'Reading 14 files', 'Running tests', 'Writing a fix'];

export type ClockFrame = {
  label: string;
  status: string;
  done: boolean;
  cardVisible: boolean;
};

export function clockFrame(tick: number): ClockFrame {
  const s = ((tick % CLOCK_PERIOD) + CLOCK_PERIOD) % CLOCK_PERIOD;
  const shown = Math.min(s, LAST_SECOND);
  const done = s >= LAST_SECOND;
  return {
    label: `0:${String(shown).padStart(2, '0')}`,
    status: done ? '✓ Done. 3 files changed.' : `${STATUSES[Math.floor(s / 3) % STATUSES.length]}…`,
    done,
    cardVisible: s >= 1 && s <= 11,
  };
}
