'use client';

import type { KeyboardEvent } from 'react';
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import type { PaletteId } from '@/lib/palette';
import {
  applyPalette,
  isPaletteId,
  PALETTE_STORAGE_KEY,
  PALETTES,
  resolvePalette,
} from '@/lib/palette';

const DARK_SCHEME_QUERY = '(prefers-color-scheme: dark)';

/** Arrow steps through the 3-column grid: left/right by one, up/down by a row. */
const ARROW_STEP: Record<string, number> = {
  ArrowRight: 1,
  ArrowLeft: -1,
  ArrowDown: 3,
  ArrowUp: -3,
};

function getStorage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function conic(c: readonly string[]): string {
  return `conic-gradient(${[...c, c[0]].join(', ')})`;
}

export function PalettePicker() {
  // The first render is deterministic so server and client markup match. The
  // pre-paint bootstrap has already applied the real palette to the document;
  // the effect below reads it back once mounted.
  const [paletteId, setPaletteId] = useState<PaletteId | null>(null);
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const optionRefs = useRef<(HTMLButtonElement | null)[]>([]);
  // Storage can throw, so remember a pick here too and stop following the system.
  const pickedRef = useRef(false);
  const titleId = useId();
  const menuId = useId();

  const select = useCallback((id: PaletteId) => {
    applyPalette(id);
    setPaletteId(id);
  }, []);

  useEffect(() => {
    const fromDocument = document.documentElement.dataset.palette;
    if (isPaletteId(fromDocument)) {
      setPaletteId(fromDocument);
    } else {
      // No bootstrap ran (or it failed): resolve the same way it would have.
      const prefersDark = !!window.matchMedia?.(DARK_SCHEME_QUERY).matches;
      select(resolvePalette(getStorage(), prefersDark).id);
    }

    // Until the visitor picks something, follow the system setting.
    const query = window.matchMedia?.(DARK_SCHEME_QUERY);
    if (!query) return;
    const onChange = (event: { matches: boolean }) => {
      if (pickedRef.current || resolvePalette(getStorage(), false).chosen) return;
      select(event.matches ? 'midnight' : 'warm');
    };
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, [select]);

  // Opened from the trigger: the checked radio is the one tab stop, so focus it.
  useEffect(() => {
    if (!open) return;
    const index = PALETTES.findIndex((p) => p.id === (paletteId ?? 'warm'));
    optionRefs.current[index]?.focus();
    // Only on opening: arrowing moves focus itself.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [open]);

  const pick = (id: PaletteId) => {
    pickedRef.current = true;
    select(id);
    try {
      window.localStorage.setItem(PALETTE_STORAGE_KEY, id);
    } catch {
      // The palette still applies for this visit when storage is unavailable.
    }
  };

  const onOptionKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const step = ARROW_STEP[event.key];
    if (!step) return;
    event.preventDefault();
    const next = (index + step + PALETTES.length) % PALETTES.length;
    pick(PALETTES[next].id);
    optionRefs.current[next]?.focus();
  };

  // Escape closes from anywhere inside the picker, the trigger included. Key
  // events from the options bubble up here too.
  const onRootKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Escape' || !open) return;
    setOpen(false);
    triggerRef.current?.focus();
  };

  const current = PALETTES.find((p) => p.id === paletteId);

  return (
    <div className="palette-picker" ref={rootRef} onKeyDown={onRootKeyDown}>
      <button
        ref={triggerRef}
        type="button"
        className="palette-picker__trigger"
        aria-label={current ? `Background: ${current.label}` : 'Background'}
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="palette-picker__current" aria-hidden="true" />
      </button>
      {open && (
        <div className="palette-picker__menu" id={menuId}>
          <p className="palette-picker__title" id={titleId}>
            Background
          </p>
          <div className="palette-picker__options" role="radiogroup" aria-labelledby={titleId}>
            {PALETTES.map((p, index) => {
              const checked = p.id === (paletteId ?? 'warm');
              return (
                <button
                  key={p.id}
                  ref={(el) => {
                    optionRefs.current[index] = el;
                  }}
                  type="button"
                  role="radio"
                  aria-checked={checked}
                  tabIndex={checked ? 0 : -1}
                  className="palette-picker__option"
                  onClick={() => pick(p.id)}
                  onKeyDown={(event) => onOptionKeyDown(event, index)}
                >
                  <i aria-hidden="true" style={{ background: conic(p.c) }} />
                  {p.label}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
