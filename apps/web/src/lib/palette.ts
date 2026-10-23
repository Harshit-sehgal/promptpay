/**
 * Homepage background palettes: the data, the storage rules and the pre-paint
 * bootstrap. Values come from the redesign spec's "Palettes" table.
 */

export type PaletteId = 'warm' | 'sunset' | 'mint' | 'lavender' | 'citrus' | 'midnight';

export interface Palette {
  id: PaletteId;
  label: string;
  page: string;
  /** The four colour-field colours. */
  c: [string, string, string, string];
  fieldOpacity: number;
  ink: string;
  copy: string;
  quiet: string;
  /** Space-separated rgb() form: the contrast test parses it. */
  glass: string;
}

const LIGHT = {
  ink: '#111111',
  copy: '#55554f',
  quiet: '#8a8a84',
  glass: 'rgb(255 255 255 / .52)',
} as const;

export const PALETTES: readonly Palette[] = [
  {
    id: 'warm',
    label: 'Warm',
    page: '#f4f3ef',
    c: ['#f6c9a8', '#c4dcc6', '#d6cdea', '#ecdcb4'],
    fieldOpacity: 0.75,
    ...LIGHT,
  },
  {
    id: 'sunset',
    label: 'Sunset',
    page: '#fbf3ee',
    c: ['#ff9f87', '#ffc98f', '#f7a8cc', '#ffd9a0'],
    fieldOpacity: 0.7,
    ...LIGHT,
  },
  {
    id: 'mint',
    label: 'Mint',
    page: '#f2f6f3',
    c: ['#9fe3c6', '#b3d9f2', '#f1ec9e', '#c9eedd'],
    fieldOpacity: 0.75,
    ...LIGHT,
  },
  {
    id: 'lavender',
    label: 'Lavender',
    page: '#f6f3f9',
    c: ['#c8b4f4', '#f5b5d4', '#b9c6f6', '#e6d4fa'],
    fieldOpacity: 0.75,
    ...LIGHT,
  },
  {
    id: 'citrus',
    label: 'Citrus',
    page: '#f7f6ee',
    c: ['#d6f08c', '#ffe07a', '#ffbf8c', '#c5ecb0'],
    fieldOpacity: 0.7,
    ...LIGHT,
  },
  {
    id: 'midnight',
    label: 'Midnight',
    page: '#0f0f12',
    c: ['#6b4cf6', '#ff7a45', '#18b88f', '#c43d8f'],
    fieldOpacity: 0.45,
    ink: '#f4f3ef',
    copy: '#b4b4bb',
    quiet: '#85858d',
    glass: 'rgb(255 255 255 / .07)',
  },
];

export const PALETTE_STORAGE_KEY = 'ateva-palette';
/** The retired light/dark toggle's key, read once to migrate `dark` to Midnight. */
export const LEGACY_THEME_KEY = 'ateva-landing-theme';

export function isPaletteId(v: unknown): v is PaletteId {
  return PALETTES.some((p) => p.id === v);
}

/**
 * Picks the palette for this visit. `chosen` is false when the result is only
 * the system default. Also migrates a legacy `dark` choice to Midnight, once.
 * Never throws: unreadable storage falls back to the system default.
 */
export function resolvePalette(
  storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null,
  prefersDark: boolean,
): { id: PaletteId; chosen: boolean } {
  const system: { id: PaletteId; chosen: boolean } = {
    id: prefersDark ? 'midnight' : 'warm',
    chosen: false,
  };
  try {
    const stored = storage?.getItem(PALETTE_STORAGE_KEY) ?? null;
    if (isPaletteId(stored)) return { id: stored, chosen: true };
    if (stored === null && storage?.getItem(LEGACY_THEME_KEY) === 'dark') {
      try {
        storage.setItem(PALETTE_STORAGE_KEY, 'midnight');
        storage.removeItem(LEGACY_THEME_KEY);
      } catch {
        // The migration is best effort; Midnight still applies for this visit.
      }
      return { id: 'midnight', chosen: true };
    }
  } catch {
    // Storage is blocked or throws: use the system default.
  }
  return system;
}

export function applyPalette(id: PaletteId, root: HTMLElement = document.documentElement): void {
  root.dataset.palette = id;
  root.classList.toggle('dark', id === 'midnight');
}

/**
 * Runs before first paint (inlined in the root layout), so it cannot import:
 * it repeats resolvePalette + applyPalette. Keep the two in step; the parity
 * test in palette.test.ts compares them case by case.
 */
export const paletteBootstrapScript = `
(() => {
  const root = document.documentElement;
  try {
    const ids = ${JSON.stringify(PALETTES.map((p) => p.id))};
    const dark = !!window.matchMedia?.('(prefers-color-scheme: dark)').matches;
    let id = dark ? 'midnight' : 'warm';
    try {
      const s = window.localStorage;
      const stored = s.getItem('${PALETTE_STORAGE_KEY}');
      if (ids.includes(stored)) {
        id = stored;
      } else if (stored === null && s.getItem('${LEGACY_THEME_KEY}') === 'dark') {
        id = 'midnight';
        try {
          s.setItem('${PALETTE_STORAGE_KEY}', 'midnight');
          s.removeItem('${LEGACY_THEME_KEY}');
        } catch {}
      }
    } catch {}
    root.dataset.palette = id;
    root.classList.toggle('dark', id === 'midnight');
    if (!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      root.dataset.motion = 'enabled';
    }
  } catch {
    root.dataset.palette = 'warm';
    root.classList.remove('dark');
  }
})();
`;
