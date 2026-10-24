'use client';

import { useEffect, useState } from 'react';
import { applyPalette, PALETTE_STORAGE_KEY } from '@/lib/palette';

type ThemePreference = 'light' | 'dark';

/**
 * Light/dark switch for the dashboards. It is a two-way shortcut onto the
 * shared background palette: dark is Midnight, light is Warm. It writes the
 * same `ateva-palette` setting as the public picker, so `.dark` and Midnight
 * always agree.
 */
export function ThemeToggle() {
  // Keep the first render deterministic so the server markup matches during
  // hydration. The prepaint bootstrap has already applied the real palette to
  // the document; the effect below synchronizes this small control right
  // after hydration without reintroducing a page-level theme flash.
  const [theme, setTheme] = useState<ThemePreference | null>(null);

  useEffect(() => {
    setTheme(document.documentElement.classList.contains('dark') ? 'dark' : 'light');
  }, []);

  const isDark = theme === 'dark';
  const nextTheme = isDark ? 'light' : 'dark';

  const toggleTheme = () => {
    const palette = nextTheme === 'dark' ? 'midnight' : 'warm';
    applyPalette(palette);
    setTheme(nextTheme);

    try {
      window.localStorage.setItem(PALETTE_STORAGE_KEY, palette);
    } catch {
      // The visual preference still applies when storage is unavailable.
    }
  };

  return (
    <button
      type="button"
      className="theme-toggle"
      aria-label={`Switch to ${nextTheme} mode`}
      aria-pressed={isDark}
      title={`Switch to ${nextTheme} mode`}
      onClick={toggleTheme}
    >
      <span className="theme-toggle__icon" aria-hidden="true">
        {isDark ? (
          <svg viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path
              d="M16.4 12.9A6.8 6.8 0 0 1 7.1 3.6a6.8 6.8 0 1 0 9.3 9.3Z"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        ) : (
          <svg viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
            <circle cx="10" cy="10" r="3.2" stroke="currentColor" strokeWidth="1.5" />
            <path
              d="M10 2v1.7M10 16.3V18M2 10h1.7M16.3 10H18M4.34 4.34l1.2 1.2m8.92 8.92 1.2 1.2m0-11.32-1.2 1.2m-8.92 8.92-1.2 1.2"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
            />
          </svg>
        )}
      </span>
      <span className="theme-toggle__label">{theme ? (isDark ? 'Dark' : 'Light') : 'Theme'}</span>
    </button>
  );
}
