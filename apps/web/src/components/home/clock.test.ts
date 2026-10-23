import { describe, expect, it } from 'vitest';

import { clockFrame } from './clock';

describe('clockFrame', () => {
  it('starts at 0:00 with the agent working and no card', () => {
    expect(clockFrame(0)).toEqual({
      label: '0:00',
      cardVisible: false,
      done: false,
      status: 'Working…',
    });
  });

  it('shows the card from 0:01 to 0:11', () => {
    expect(clockFrame(1).cardVisible).toBe(true);
    expect(clockFrame(11).cardVisible).toBe(true);
    expect(clockFrame(12).cardVisible).toBe(false);
  });

  it('finishes at 0:12 and holds there until the loop restarts', () => {
    expect(clockFrame(12)).toMatchObject({ label: '0:12', done: true });
    expect(clockFrame(12).status).toBe('✓ Done. 3 files changed.');
    expect(clockFrame(15).label).toBe('0:12');
  });

  it('loops every 16 ticks', () => {
    expect(clockFrame(16)).toEqual(clockFrame(0));
    expect(clockFrame(16 * 1000 + 5)).toEqual(clockFrame(5));
  });

  it('never shows more than 0:12', () => {
    for (let t = 0; t <= 200; t++) {
      expect(clockFrame(t).label <= '0:12').toBe(true);
    }
  });
});
