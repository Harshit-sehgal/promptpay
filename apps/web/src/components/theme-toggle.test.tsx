// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

import { THEME_STORAGE_KEY, ThemeToggle } from './theme-toggle';

describe('ThemeToggle', () => {
  beforeEach(() => {
    window.localStorage.clear();
    document.documentElement.removeAttribute('data-landing-theme');
    document.documentElement.classList.remove('dark');
  });

  afterEach(() => cleanup());

  it('switches to dark mode and remembers the preference', () => {
    render(<ThemeToggle />);

    fireEvent.click(screen.getByRole('button', { name: 'Switch to dark mode' }));

    expect(document.documentElement.dataset.landingTheme).toBe('dark');
    expect(document.documentElement.classList.contains('dark')).toBe(true);
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark');
    expect(screen.getByRole('button', { name: 'Switch to light mode' })).toBeTruthy();
  });

  it('restores a stored dark-mode preference after mounting', async () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, 'dark');

    render(<ThemeToggle />);

    await waitFor(() => {
      expect(document.documentElement.dataset.landingTheme).toBe('dark');
      expect(document.documentElement.classList.contains('dark')).toBe(true);
      expect(screen.getByRole('button', { name: 'Switch to light mode' })).toBeTruthy();
    });
  });
});
