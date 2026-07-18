'use client';

export function SkipLink() {
  return (
    <a
      href="#main-content"
      className={[
        // Visually hidden by default (screen-reader only)
        'absolute -m-px h-px w-px -translate-y-full overflow-hidden whitespace-nowrap border-0 p-0',
        // Become visible on focus, sliding down from the top of the viewport
        'focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:h-auto focus:w-auto focus:translate-y-0',
        'focus:rounded-md focus:bg-white focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-surface-950',
        'focus:shadow-lg focus:outline focus:outline-2 focus:outline-brand-600',
      ].join(' ')}
    >
      Skip to main content
    </a>
  );
}
