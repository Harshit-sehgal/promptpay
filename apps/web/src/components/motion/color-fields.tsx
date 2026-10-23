'use client';

import { useEffect, useRef } from 'react';

type ColorField = {
  /** Which palette colour to use: --c1 to --c4. */
  color: 1 | 2 | 3 | 4;
  /** Diameter in px. */
  size: number;
  /** CSS `left` and `top` inside the parent section. */
  x: string;
  y: string;
  /** Parallax factor: the field moves by scrollY * speed. */
  speed: number;
};

/* Blurred palette circles behind the glass. The parent section must be
   `position: relative`; the fields are not clipped, the page clips sideways overflow. */
export function ColorFields({ fields }: { fields: ColorField[] }) {
  const nodes = useRef<(HTMLDivElement | null)[]>([]);

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    let frame = 0;
    const update = () => {
      frame = 0;
      nodes.current.forEach((node, index) => {
        if (node)
          node.style.transform = `translate3d(0, ${window.scrollY * fields[index].speed}px, 0)`;
      });
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    update();
    return () => {
      window.removeEventListener('scroll', onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [fields]);

  return (
    <div className="color-fields">
      {fields.map((field, index) => (
        <div
          key={index}
          ref={(node) => {
            nodes.current[index] = node;
          }}
          aria-hidden="true"
          className="color-field"
          style={{
            width: field.size,
            height: field.size,
            left: field.x,
            top: field.y,
            backgroundColor: `var(--c${field.color})`,
          }}
        />
      ))}
    </div>
  );
}
