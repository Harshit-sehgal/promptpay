// @vitest-environment jsdom
import { renderToString } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';

import { Hero } from './hero';

vi.mock('@/lib/auth-context', () => ({
  useAuth: () => ({ isAuthenticated: false, user: null }),
}));

function setVisibility(state: 'visible' | 'hidden') {
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: state });
  act(() => {
    document.dispatchEvent(new Event('visibilitychange'));
  });
}

const clockText = (container: HTMLElement) => container.querySelector('.home-clock')?.textContent;

describe('Hero', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    window.matchMedia = vi.fn().mockImplementation(() => ({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })) as unknown as typeof window.matchMedia;
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
  });

  it('server-renders 0:05 with the sponsor card showing', () => {
    const html = renderToString(<Hero />);
    const doc = new DOMParser().parseFromString(html, 'text/html');

    expect(doc.querySelector('.home-clock')?.textContent).toBe('0:05');
    expect(doc.querySelector('.hero-card')?.classList.contains('is-visible')).toBe(true);
  });

  it('ticks once a second after mount', () => {
    const { container } = render(<Hero />);
    expect(clockText(container)).toBe('0:05');

    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(clockText(container)).toBe('0:06');
  });

  it('pauses while the tab is hidden and resumes without catching up', () => {
    const { container } = render(<Hero />);

    setVisibility('hidden');
    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(clockText(container)).toBe('0:05');

    setVisibility('visible');
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(clockText(container)).toBe('0:06');
  });

  it('keeps the live timer out of the heading name', () => {
    const { container } = render(<Hero />);
    const heading = container.querySelector('h1');

    expect(heading?.querySelector('.home-clock')?.closest('[aria-hidden="true"]')).toBeTruthy();
    expect(heading?.querySelector('.sr-only')?.textContent).toBe('a few seconds');
  });
});
