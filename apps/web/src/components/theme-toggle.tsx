'use client';

import { useEffect, useState } from 'react';

export const THEME_STORAGE_KEY = 'ateva-landing-theme';

export type ThemePreference = 'light' | 'dark';

function readStoredTheme(): ThemePreference | null {
  try {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
    return stored === 'dark' || stored === 'light' ? stored : null;
  } catch {
    return null;
  }
}

export function applyTheme(theme: ThemePreference) {
  document.documentElement.dataset.landingTheme = theme;
  document.documentElement.classList.toggle('dark', theme === 'dark');
}

export function ThemeToggle() {
  // Keep the first render deterministic so the server markup matches during
  // hydration. The prepaint bootstrap has already applied the real theme to
  // the document; the effect below synchronizes this small control immediately
  // after hydration without reintroducing a page-level theme flash.
  const [theme, setTheme] = useState<ThemePreference | null>(null);

  useEffect(() => {
    const storedTheme = readStoredTheme();
    if (storedTheme) applyTheme(storedTheme);
    setTheme(document.documentElement.classList.contains('dark') ? 'dark' : 'light');
  }, []);

  const isDark = theme === 'dark';
  const nextTheme = isDark ? 'light' : 'dark';

  const toggleTheme = () => {
    applyTheme(nextTheme);
    setTheme(nextTheme);

    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, nextTheme);
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
