import type { Metadata } from 'next';

/**
 * Metadata carrier for `auth/signup`.
 *
 * The page itself is a Client Component and a Client Component cannot
 * export `metadata`, so without this layout the route inherits the root
 * layout's marketing title. 37 pages were shipping that way: every tab,
 * bookmark and shared link read the same string.
 */
export const metadata: Metadata = {
  title: 'Create an account — WaitLayer',
  description: 'Create a WaitLayer account to start verifying AI wait states.',
  // Defence in depth alongside robots.ts: this surface must never be indexed.
  robots: { index: false, follow: false },
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
