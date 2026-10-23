// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PALETTE_STORAGE_KEY } from '@/lib/palette';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

import { ThemeToggle } from './theme-toggle';

const html = document.documentElement;

describe('ThemeToggle', () => {
  beforeEach(() => {
    window.localStorage.clear();
    html.dataset.palette = 'warm';
    html.classList.remove('dark');
  });

  afterEach(() => cleanup());

  it('switches warm and midnight through the shared palette setting', () => {
    render(<ThemeToggle />);

    fireEvent.click(screen.getByRole('button', { name: 'Switch to dark mode' }));

    expect(window.localStorage.getItem(PALETTE_STORAGE_KEY)).toBe('midnight');
    expect(html.dataset.palette).toBe('midnight');
    expect(html.classList.contains('dark')).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: 'Switch to light mode' }));

    expect(window.localStorage.getItem(PALETTE_STORAGE_KEY)).toBe('warm');
    expect(html.dataset.palette).toBe('warm');
    expect(html.classList.contains('dark')).toBe(false);
  });

  it('reads the palette the pre-paint bootstrap applied', async () => {
    html.dataset.palette = 'midnight';
    html.classList.add('dark');

    render(<ThemeToggle />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Switch to light mode' })).toBeTruthy();
    });
  });
});
