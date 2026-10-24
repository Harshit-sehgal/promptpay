import Link from 'next/link';
import { type ReactNode } from 'react';

export type ActionVariant = 'primary' | 'glass' | 'text';

/** Navigation styled as an action: ink pill, glass pill, or text with an arrow. */
export function ActionLink({
  href,
  variant = 'glass',
  children,
}: {
  href: string;
  variant?: ActionVariant;
  children: ReactNode;
}) {
  return (
    <Link href={href} className={`dash-action dash-action--${variant}`}>
      {children}
      {variant === 'text' && (
        <span className="dash-action__arrow" aria-hidden="true">
          →
        </span>
      )}
    </Link>
  );
}
