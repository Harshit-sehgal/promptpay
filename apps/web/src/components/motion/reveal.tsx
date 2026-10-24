'use client';

import { type CSSProperties, type ReactNode, useLayoutEffect, useRef, useState } from 'react';

type RevealProps = {
  as?: 'div' | 'p' | 'h2' | 'section';
  /** Position among siblings; each step delays the reveal by 70ms. */
  delayIndex?: number;
  className?: string;
  children: ReactNode;
};

/* Fades and lifts its children in once, the first time they scroll into view.
   The hidden state lives in CSS behind html[data-motion='enabled'] and
   html[data-reveal-ready], the flag set below once React is running, so
   without JS, before hydration or under reduced motion the content is simply
   visible. Content already on screen is marked in by the same layout effect
   that sets the flag, before paint, so it never blinks out on load. */
export function Reveal({ as: Tag = 'div', delayIndex = 0, className, children }: RevealProps) {
  const ref = useRef<HTMLElement | null>(null);
  const setRef = (node: HTMLElement | null) => {
    ref.current = node;
  };
  const [isIn, setIsIn] = useState(false);

  useLayoutEffect(() => {
    document.documentElement.dataset.revealReady = 'true';
    const node = ref.current;
    const rect = node?.getBoundingClientRect();
    if (
      typeof IntersectionObserver === 'undefined' ||
      window.matchMedia('(prefers-reduced-motion: reduce)').matches ||
      (rect && rect.bottom > 0 && rect.top < window.innerHeight)
    ) {
      node?.classList.add('is-in');
      setIsIn(true);
      return;
    }
    if (!node) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setIsIn(true);
          observer.disconnect();
        }
      },
      { threshold: 0.15 },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  return (
    <Tag
      ref={setRef}
      className={['reveal', isIn && 'is-in', className].filter(Boolean).join(' ')}
      style={{ '--i': delayIndex } as CSSProperties}
    >
      {children}
    </Tag>
  );
}
