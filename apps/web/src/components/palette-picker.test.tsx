// @vitest-environment jsdom
import { renderToString } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PALETTE_STORAGE_KEY } from '@/lib/palette';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

import { PalettePicker } from './palette-picker';

type MediaListener = (event: { matches: boolean }) => void;
let mediaListeners: MediaListener[] = [];

function fireSystemScheme(matches: boolean) {
  act(() => {
    mediaListeners.forEach((listener) => listener({ matches }));
  });
}

const html = document.documentElement;

async function renderPicker() {
  render(<PalettePicker />);
  await screen.findByRole('button', { name: 'Background: Warm' });
}

function openMenu() {
  fireEvent.click(screen.getByRole('button', { name: /^Background/ }));
}

describe('PalettePicker', () => {
  beforeEach(() => {
    mediaListeners = [];
    window.localStorage.clear();
    html.dataset.palette = 'warm';
    html.classList.remove('dark');
    window.matchMedia = vi.fn().mockImplementation(() => ({
      matches: false,
      addEventListener: (_type: string, listener: MediaListener) => mediaListeners.push(listener),
      removeEventListener: (_type: string, listener: MediaListener) => {
        mediaListeners = mediaListeners.filter((l) => l !== listener);
      },
    })) as unknown as typeof window.matchMedia;
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('renders a deterministic first label, then syncs it from the document', async () => {
    html.dataset.palette = 'mint';
    // Server markup (no effects) is what hydration compares against.
    expect(renderToString(<PalettePicker />)).toContain('aria-label="Background"');

    render(<PalettePicker />);
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Background: Mint' })).toBeTruthy();
    });
  });

  it('opens a radiogroup of six palettes with the current one checked', async () => {
    await renderPicker();
    const trigger = screen.getByRole('button', { name: 'Background: Warm' });
    expect(trigger.getAttribute('aria-expanded')).toBe('false');

    fireEvent.click(trigger);

    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByRole('radiogroup', { name: 'Background' })).toBeTruthy();
    expect(screen.getAllByRole('radio')).toHaveLength(6);
    expect(screen.getByRole('radio', { name: 'Warm' }).getAttribute('aria-checked')).toBe('true');
    expect(document.activeElement).toBe(screen.getByRole('radio', { name: 'Warm' }));
  });

  it('applies, stores and marks a clicked palette', async () => {
    await renderPicker();
    openMenu();

    fireEvent.click(screen.getByRole('radio', { name: 'Mint' }));

    expect(html.dataset.palette).toBe('mint');
    expect(window.localStorage.getItem(PALETTE_STORAGE_KEY)).toBe('mint');
    expect(screen.getByRole('radio', { name: 'Mint' }).getAttribute('aria-checked')).toBe('true');
    expect(screen.getByRole('radio', { name: 'Warm' }).getAttribute('aria-checked')).toBe('false');
    expect(screen.getByRole('button', { name: 'Background: Mint' })).toBeTruthy();
  });

  it('moves and applies with the arrow keys, wrapping at the ends', async () => {
    await renderPicker();
    openMenu();

    fireEvent.keyDown(screen.getByRole('radio', { name: 'Warm' }), { key: 'ArrowRight' });
    expect(html.dataset.palette).toBe('sunset');
    expect(document.activeElement).toBe(screen.getByRole('radio', { name: 'Sunset' }));

    fireEvent.keyDown(screen.getByRole('radio', { name: 'Sunset' }), { key: 'ArrowLeft' });
    fireEvent.keyDown(screen.getByRole('radio', { name: 'Warm' }), { key: 'ArrowLeft' });
    expect(html.dataset.palette).toBe('midnight');
    expect(document.activeElement).toBe(screen.getByRole('radio', { name: 'Midnight' }));
  });

  it('uses roving tabindex so only the checked radio is a tab stop', async () => {
    await renderPicker();
    openMenu();

    const tabIndexes = screen.getAllByRole('radio').map((r) => r.getAttribute('tabindex'));
    expect(tabIndexes).toEqual(['0', '-1', '-1', '-1', '-1', '-1']);
  });

  it('closes on Escape and returns focus to the trigger', async () => {
    await renderPicker();
    openMenu();

    fireEvent.keyDown(screen.getByRole('radio', { name: 'Warm' }), { key: 'Escape' });

    expect(screen.queryByRole('radiogroup')).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Background: Warm' }));
  });

  it('closes on Escape while the trigger itself has focus', async () => {
    await renderPicker();
    openMenu();

    const trigger = screen.getByRole('button', { name: 'Background: Warm' });
    trigger.focus();
    fireEvent.keyDown(trigger, { key: 'Escape' });

    expect(screen.queryByRole('radiogroup')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it('closes on a press outside, but not inside, the picker', async () => {
    await renderPicker();
    openMenu();

    fireEvent.mouseDown(screen.getByRole('radiogroup'));
    expect(screen.getByRole('radiogroup')).toBeTruthy();

    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole('radiogroup')).toBeNull();
  });

  it('follows the system scheme until the visitor picks, then ignores it', async () => {
    await renderPicker();

    fireSystemScheme(true);
    expect(html.dataset.palette).toBe('midnight');
    expect(html.classList.contains('dark')).toBe(true);
    await screen.findByRole('button', { name: 'Background: Midnight' });

    fireSystemScheme(false);
    expect(html.dataset.palette).toBe('warm');

    openMenu();
    fireEvent.click(screen.getByRole('radio', { name: 'Lavender' }));
    fireSystemScheme(true);
    expect(html.dataset.palette).toBe('lavender');
  });

  it('keeps ignoring the system scheme after a pick even when storage cannot save it', async () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError');
    });
    await renderPicker();
    openMenu();
    fireEvent.click(screen.getByRole('radio', { name: 'Citrus' }));

    fireSystemScheme(true);

    expect(html.dataset.palette).toBe('citrus');
  });

  it('still recolours when storage throws on write', async () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError');
    });
    await renderPicker();
    openMenu();

    expect(() => fireEvent.click(screen.getByRole('radio', { name: 'Citrus' }))).not.toThrow();

    expect(html.dataset.palette).toBe('citrus');
    expect(screen.getByRole('radio', { name: 'Citrus' }).getAttribute('aria-checked')).toBe('true');
  });
});
