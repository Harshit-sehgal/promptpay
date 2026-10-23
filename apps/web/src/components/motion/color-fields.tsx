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
  /** Parallax factor: the field moves by (section centre - viewport centre) * speed. */
  speed: number;
};

/* Blurred palette circles behind the glass. The parent section must be
   `position: relative`; the fields are not clipped, the page clips sideways overflow.
   Parallax is relative to that section, so a field sits untransformed when its
   section is centred in the viewport. Pass a module-level constant `fields`
   array: the effect re-subscribes whenever the array identity changes. */
export function ColorFields({ fields }: { fields: ColorField[] }) {
  const wrapper = useRef<HTMLDivElement>(null);
  const nodes = useRef<(HTMLDivElement | null)[]>([]);

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const section = wrapper.current?.parentElement;
    if (!section) return;
    let frame = 0;
    const update = () => {
      frame = 0;
      const rect = section.getBoundingClientRect();
      const offset = rect.top + rect.height / 2 - window.innerHeight / 2;
      nodes.current.forEach((node, index) => {
        if (node) node.style.transform = `translate3d(0, ${offset * fields[index].speed}px, 0)`;
      });
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll, { passive: true });
    update();
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [fields]);

  return (
    <div ref={wrapper} className="color-fields">
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
