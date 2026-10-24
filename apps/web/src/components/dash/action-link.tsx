import Link from 'next/link';
import { type ReactNode } from 'react';

export type ActionVariant = 'primary' | 'secondary' | 'text';

/** Navigation styled as an action: ink button, outlined button, or underlined text. */
export function ActionLink({
  href,
  variant = 'secondary',
  children,
}: {
  href: string;
  variant?: ActionVariant;
  children: ReactNode;
}) {
  return (
    <Link href={href} className={`dash-action dash-action--${variant}`}>
      {children}
    </Link>
  );
}
