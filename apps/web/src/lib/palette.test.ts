// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';

import {
  applyPalette,
  isPaletteId,
  LEGACY_THEME_KEY,
  PALETTE_STORAGE_KEY,
  paletteBootstrapScript,
  PALETTES,
  resolvePalette,
} from './palette';

function memoryStorage(seed: Record<string, string> = {}) {
  const data = new Map(Object.entries(seed));
  return {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
  };
}

const throwingStorage = {
  getItem: () => {
    throw new Error('blocked');
  },
  setItem: () => {
    throw new Error('blocked');
  },
  removeItem: () => {
    throw new Error('blocked');
  },
};

describe('resolvePalette', () => {
  it('defaults to warm, or midnight when the system prefers dark', () => {
    expect(resolvePalette(null, false)).toEqual({ id: 'warm', chosen: false });
    expect(resolvePalette(null, true)).toEqual({ id: 'midnight', chosen: false });
  });

  it('returns a stored palette as chosen', () => {
    const s = memoryStorage({ [PALETTE_STORAGE_KEY]: 'mint' });
    expect(resolvePalette(s, true)).toEqual({ id: 'mint', chosen: true });
  });

  it('ignores an unknown stored value', () => {
    const s = memoryStorage({ [PALETTE_STORAGE_KEY]: 'neon' });
    expect(resolvePalette(s, false)).toEqual({ id: 'warm', chosen: false });
  });

  it('migrates legacy dark to midnight once', () => {
    const s = memoryStorage({ [LEGACY_THEME_KEY]: 'dark' });
    expect(resolvePalette(s, false)).toEqual({ id: 'midnight', chosen: true });
    expect(s.getItem(PALETTE_STORAGE_KEY)).toBe('midnight');
    expect(s.getItem(LEGACY_THEME_KEY)).toBeNull();
  });

  it('leaves legacy light alone and uses the system default', () => {
    const s = memoryStorage({ [LEGACY_THEME_KEY]: 'light' });
    expect(resolvePalette(s, false)).toEqual({ id: 'warm', chosen: false });
    expect(s.getItem(LEGACY_THEME_KEY)).toBe('light');
  });

  it('prefers the new key over a legacy dark value', () => {
    const s = memoryStorage({ [PALETTE_STORAGE_KEY]: 'citrus', [LEGACY_THEME_KEY]: 'dark' });
    expect(resolvePalette(s, false)).toEqual({ id: 'citrus', chosen: true });
    expect(s.getItem(LEGACY_THEME_KEY)).toBe('dark');
  });

  it('does not throw when storage throws', () => {
    expect(resolvePalette(throwingStorage, false)).toEqual({ id: 'warm', chosen: false });
    expect(resolvePalette(throwingStorage, true)).toEqual({ id: 'midnight', chosen: false });
  });

  it('still applies midnight when the migration write fails', () => {
    const s = {
      ...memoryStorage({ [LEGACY_THEME_KEY]: 'dark' }),
      setItem: () => {
        throw new Error('quota');
      },
    };
    expect(resolvePalette(s, false)).toEqual({ id: 'midnight', chosen: true });
  });
});

describe('applyPalette', () => {
  it('sets data-palette and toggles .dark only for midnight', () => {
    const el = document.createElement('html');
    applyPalette('midnight', el);
    expect(el.dataset.palette).toBe('midnight');
    expect(el.classList.contains('dark')).toBe(true);
    applyPalette('warm', el);
    expect(el.dataset.palette).toBe('warm');
    expect(el.classList.contains('dark')).toBe(false);
  });
});

describe('PALETTES', () => {
  it('lists the six ids in spec order, unique', () => {
    expect(PALETTES.map((p) => p.id)).toEqual([
      'warm',
      'sunset',
      'mint',
      'lavender',
      'citrus',
      'midnight',
    ]);
    expect(new Set(PALETTES.map((p) => p.id)).size).toBe(PALETTES.length);
    expect(PALETTES.every((p) => isPaletteId(p.id))).toBe(true);
    expect(isPaletteId('neon')).toBe(false);
  });
});

describe('paletteBootstrapScript parity', () => {
  const root = document.documentElement;

  function runBootstrap(opts: { storage: unknown; prefersDark: boolean; reducedMotion?: boolean }) {
    const win = {
      get localStorage() {
        if (opts.storage === 'throw') throw new Error('blocked');
        return opts.storage;
      },
      matchMedia: (q: string) => ({
        matches: q.includes('prefers-color-scheme') ? opts.prefersDark : !!opts.reducedMotion,
      }),
    };
    new Function('window', 'document', paletteBootstrapScript)(win, document);
  }

  beforeEach(() => {
    root.removeAttribute('data-palette');
    root.removeAttribute('data-motion');
    root.classList.remove('dark');
  });

  const cases: [string, () => ReturnType<typeof memoryStorage> | null, boolean][] = [
    ['no storage, light', () => null, false],
    ['no storage, dark', () => null, true],
    ['stored mint', () => memoryStorage({ [PALETTE_STORAGE_KEY]: 'mint' }), true],
    ['stored neon', () => memoryStorage({ [PALETTE_STORAGE_KEY]: 'neon' }), false],
    ['legacy dark', () => memoryStorage({ [LEGACY_THEME_KEY]: 'dark' }), false],
    ['legacy light', () => memoryStorage({ [LEGACY_THEME_KEY]: 'light' }), false],
    [
      'citrus over legacy dark',
      () => memoryStorage({ [PALETTE_STORAGE_KEY]: 'citrus', [LEGACY_THEME_KEY]: 'dark' }),
      false,
    ],
  ];

  it.each(cases)('matches resolvePalette: %s', (_name, makeStorage, prefersDark) => {
    const expected = resolvePalette(makeStorage(), prefersDark);
    const storage = makeStorage();
    runBootstrap({ storage, prefersDark });
    expect(root.dataset.palette).toBe(expected.id);
    expect(root.classList.contains('dark')).toBe(expected.id === 'midnight');
    // Migration side effects match resolvePalette's too.
    const reference = makeStorage();
    resolvePalette(reference, prefersDark);
    for (const key of [PALETTE_STORAGE_KEY, LEGACY_THEME_KEY]) {
      expect(storage?.getItem(key) ?? null).toBe(reference?.getItem(key) ?? null);
    }
  });

  it('falls back to the system default when storage throws', () => {
    runBootstrap({ storage: 'throw', prefersDark: true });
    expect(root.dataset.palette).toBe(resolvePalette(throwingStorage, true).id);
  });

  it('applies warm and clears .dark when the script body fails', () => {
    root.classList.add('dark');
    const win = {
      get localStorage(): never {
        throw new Error('x');
      },
      matchMedia: () => {
        throw new Error('matchMedia broke');
      },
    };
    new Function('window', 'document', paletteBootstrapScript)(win, document);
    expect(root.dataset.palette).toBe('warm');
    expect(root.classList.contains('dark')).toBe(false);
  });

  it('enables motion unless reduced motion is preferred', () => {
    runBootstrap({ storage: null, prefersDark: false });
    expect(root.dataset.motion).toBe('enabled');
    root.removeAttribute('data-motion');
    runBootstrap({ storage: null, prefersDark: false, reducedMotion: true });
    expect(root.dataset.motion).toBeUndefined();
  });
});
