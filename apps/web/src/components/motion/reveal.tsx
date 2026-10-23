'use client';

import { type CSSProperties, type ReactNode, useEffect, useRef, useState } from 'react';

type RevealProps = {
  as?: 'div' | 'p' | 'h2' | 'section';
  /** Position among siblings; each step delays the reveal by 70ms. */
  delayIndex?: number;
  className?: string;
  children: ReactNode;
};

/* Fades and lifts its children in once, the first time they scroll into view.
   The hidden state lives in CSS behind html[data-motion='enabled'], so without
   JS or under reduced motion the content is simply visible. */
export function Reveal({ as: Tag = 'div', delayIndex = 0, className, children }: RevealProps) {
  const ref = useRef<HTMLElement | null>(null);
  const setRef = (node: HTMLElement | null) => {
    ref.current = node;
  };
  const [isIn, setIsIn] = useState(false);

  useEffect(() => {
    if (
      typeof IntersectionObserver === 'undefined' ||
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
    ) {
      setIsIn(true);
      return;
    }
    const node = ref.current;
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
