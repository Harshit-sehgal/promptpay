import { type ColorField, ColorFields } from './color-fields';

/* The fixed backdrop behind every public page except the homepage, which
   places its own fields per section. The parent is the viewport, so the
   parallax offset stays at zero; the speeds only matter if that changes. */
const PAGE_FIELDS: ColorField[] = [
  { color: 1, size: 640, x: '-14%', y: '-12%', speed: 0.04 },
  { color: 2, size: 560, x: '64%', y: '14%', speed: 0.05 },
  { color: 3, size: 600, x: '20%', y: '62%', speed: 0.03 },
];

/** Fixed palette colour fields behind a public or auth page's content. */
export function PageBackdrop() {
  return (
    <div aria-hidden="true" className="page-backdrop">
      <ColorFields fields={PAGE_FIELDS} />
    </div>
  );
}
