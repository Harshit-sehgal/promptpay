/**
 * The Ateva logo mark.
 *
 * Three bars, the last one short and in the brand accent — the wait that gets
 * measured rather than completed.
 *
 * This exists because the mark was previously inlined per page: the homepage
 * carried this SVG while fifteen other pages carried a rounded badge holding
 * the letter `W`, left over from the WaitLayer name. A rename that greps for
 * "WaitLayer" cannot find a bare letter, so `/pricing`, `/faq`, every `/auth/*`
 * page and the OpenGraph card all kept branding the product as the old name
 * long after the rename was believed complete. One component, one mark.
 *
 * The upper bars use `currentColor` so the mark works on light and dark
 * surfaces alike; only the accent bar is fixed.
 */
export function BrandMark({ size = 17, className }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      aria-hidden="true"
      className={className}
      focusable="false"
    >
      <rect x="0" y="1.5" width="16" height="2.4" rx="0.4" fill="currentColor" />
      <rect x="0" y="6.8" width="16" height="2.4" rx="0.4" fill="currentColor" />
      <rect x="0" y="12.1" width="11" height="2.4" rx="0.4" className="fill-brand-500" />
    </svg>
  );
}
