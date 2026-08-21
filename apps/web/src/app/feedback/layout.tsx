import type { Metadata } from 'next';

/**
 * Metadata carrier for `feedback`.
 *
 * The page itself is a Client Component and a Client Component cannot
 * export `metadata`, so without this layout the route inherits the root
 * layout's marketing title. 37 pages were shipping that way: every tab,
 * bookmark and shared link read the same string.
 */
export const metadata: Metadata = {
  title: 'Feedback — Ateva',
  description:
    'Send feedback, report a problem, or request a feature. Every message reaches the team directly.',
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
