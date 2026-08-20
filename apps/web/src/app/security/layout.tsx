import type { Metadata } from 'next';

/**
 * Metadata carrier for `security`.
 *
 * The page itself is a Client Component and a Client Component cannot
 * export `metadata`, so without this layout the route inherits the root
 * layout's marketing title. 37 pages were shipping that way: every tab,
 * bookmark and shared link read the same string.
 */
export const metadata: Metadata = {
  title: 'Security — Ateva',
  description:
    'How Ateva protects accounts and payout data: encryption at rest, two-factor authentication, and abuse controls.',
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
