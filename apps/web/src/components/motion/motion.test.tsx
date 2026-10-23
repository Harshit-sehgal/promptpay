// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';

import { ColorFields } from './color-fields';
import { Reveal } from './reveal';

type ObserverCallback = (entries: { isIntersecting: boolean }[]) => void;

let observers: {
  callback: ObserverCallback;
  options?: IntersectionObserverInit;
  disconnect: ReturnType<typeof vi.fn>;
}[];

function stubMotion(reduced: boolean) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: reduced && query === '(prefers-reduced-motion: reduce)',
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  })) as unknown as typeof window.matchMedia;
}

function report(isIntersecting: boolean) {
  act(() => observers[0].callback([{ isIntersecting }]));
}

const FIELDS = [
  { color: 1, size: 520, x: '60%', y: '-40px', speed: 0.08 },
  { color: 3, size: 380, x: '-100px', y: '280px', speed: -0.05 },
] as const;

beforeEach(() => {
  observers = [];
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      disconnect = vi.fn();
      constructor(callback: ObserverCallback, options?: IntersectionObserverInit) {
        observers.push({ callback, options, disconnect: this.disconnect });
      }
      observe() {}
      unobserve() {}
    },
  );
  stubMotion(false);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('Reveal', () => {
  it('adds is-in on first intersection, keeps it, and disconnects', () => {
    const { container } = render(<Reveal>hello</Reveal>);
    const el = container.firstElementChild as HTMLElement;

    expect(el.classList.contains('reveal')).toBe(true);
    expect(el.classList.contains('is-in')).toBe(false);
    expect(observers[0].options?.threshold).toBe(0.15);

    report(false);
    expect(el.classList.contains('is-in')).toBe(false);

    report(true);
    expect(el.classList.contains('is-in')).toBe(true);
    expect(observers[0].disconnect).toHaveBeenCalled();

    report(false);
    expect(el.classList.contains('is-in')).toBe(true);
  });

  it('renders the requested tag, class and stagger index', () => {
    const { container } = render(
      <Reveal as="h2" delayIndex={3} className="lede">
        title
      </Reveal>,
    );
    const el = container.firstElementChild as HTMLElement;

    expect(el.tagName).toBe('H2');
    expect(el.classList.contains('lede')).toBe(true);
    expect(el.style.getPropertyValue('--i')).toBe('3');
  });

  it('is already in, with no observer, under reduced motion', () => {
    stubMotion(true);
    const { container } = render(<Reveal>hello</Reveal>);

    expect((container.firstElementChild as HTMLElement).classList.contains('is-in')).toBe(true);
    expect(observers).toHaveLength(0);
  });
});

describe('ColorFields', () => {
  it('renders every field aria-hidden with its colour and size', () => {
    const { container } = render(<ColorFields fields={[...FIELDS]} />);
    const fields = container.querySelectorAll<HTMLElement>('.color-field');

    expect(fields).toHaveLength(2);
    fields.forEach((field) => expect(field.getAttribute('aria-hidden')).toBe('true'));
    expect(fields[0].style.backgroundColor).toBe('var(--c1)');
    expect(fields[1].style.backgroundColor).toBe('var(--c3)');
    expect(fields[0].style.width).toBe('520px');
    expect(fields[0].style.left).toBe('60%');
    expect(fields[0].style.top).toBe('-40px');
  });

  it('moves each field by scrollY times its speed on a scroll frame', () => {
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
      cb(0);
      return 1;
    });
    const { container } = render(<ColorFields fields={[...FIELDS]} />);
    const fields = container.querySelectorAll<HTMLElement>('.color-field');

    Object.defineProperty(window, 'scrollY', { value: 500, configurable: true });
    act(() => {
      window.dispatchEvent(new Event('scroll'));
    });

    expect(fields[0].style.transform).toBe('translate3d(0, 40px, 0)');
    expect(fields[1].style.transform).toBe('translate3d(0, -25px, 0)');
  });

  it('removes its scroll listener on unmount', () => {
    const add = vi.spyOn(window, 'addEventListener');
    const remove = vi.spyOn(window, 'removeEventListener');
    const { unmount } = render(<ColorFields fields={[...FIELDS]} />);

    expect(add).toHaveBeenCalledWith('scroll', expect.any(Function), { passive: true });
    unmount();
    expect(remove).toHaveBeenCalledWith('scroll', expect.any(Function));
  });

  it('never attaches a scroll listener under reduced motion', () => {
    stubMotion(true);
    const add = vi.spyOn(window, 'addEventListener');
    const { container } = render(<ColorFields fields={[...FIELDS]} />);

    expect(add.mock.calls.filter(([type]) => type === 'scroll')).toHaveLength(0);
    container
      .querySelectorAll('.color-field')
      .forEach((field) => expect(field.getAttribute('aria-hidden')).toBe('true'));
  });
});
