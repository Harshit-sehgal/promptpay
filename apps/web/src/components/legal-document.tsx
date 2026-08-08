import Link from 'next/link';
import type { ReactNode } from 'react';

/**
 * Shared chrome for the standalone legal documents (cookie policy, data
 * retention schedule, GDPR DPA).
 *
 * A-087: these three pages previously read their bodies from repo-root
 * `docs/legal/*.md` via `path.join(process.cwd(), 'docs', ...)` at request
 * time. During `next build` the cwd is `apps/web`, so the read always threw
 * ENOENT and a `try/catch` silently substituted the string
 * "Content unavailable." — which was then frozen into the prerendered HTML of
 * all three statically-generated routes. They were linked from the footer of
 * every page and had never rendered their real content in any build.
 *
 * The content now lives in the component tree: no filesystem access, nothing
 * to trace into a standalone/serverless bundle, and no silent fallback that
 * can degrade to an apology string. `/terms` and `/privacy` already worked
 * this way; this brings the remaining three in line.
 */
export function LegalDocument({
  title,
  lastUpdated,
  children,
}: {
  title: string;
  lastUpdated: string;
  children: ReactNode;
}) {
  return (
    <main id="main-content" tabIndex={-1} className="min-h-screen bg-white px-6 py-20">
      <div className="mx-auto max-w-3xl">
        <Link
          href="/"
          className="mb-8 inline-flex items-center gap-2 text-sm font-medium text-surface-500 transition-colors hover:text-surface-700"
        >
          ← Back to home
        </Link>
        <h1 className="mb-3 text-4xl font-bold tracking-tight text-surface-900">{title}</h1>
        <p className="mb-10 text-sm text-surface-500">Last updated: {lastUpdated}</p>
        <div className="space-y-6 text-sm leading-relaxed text-surface-600">{children}</div>
      </div>
    </main>
  );
}

/** Section heading, matching the `/terms` and `/privacy` scale. */
export function LegalHeading({ children }: { children: ReactNode }) {
  return <h2 className="mb-3 mt-10 text-xl font-semibold text-surface-900">{children}</h2>;
}

/**
 * Horizontally scrollable table wrapper. The retention schedule and the DPA
 * legal-basis table are both wider than a phone viewport; without this the
 * page body itself scrolls sideways.
 *
 * The wrapper is focusable on purpose. A scrollable region that cannot take
 * focus is unreachable for anyone driving the page from a keyboard: they can
 * see that the table is cut off and have no way to scroll it. axe reports this
 * as `scrollable-region-focusable` (serious), and both legal pages were
 * shipping it.
 *
 * `tabIndex={0}` alone silences the rule, but a focus stop that announces
 * nothing is its own problem — so the region is named. `label` is required
 * rather than optional: `role="region"` without an accessible name is itself a
 * violation, and making it optional invites exactly that.
 */
export function LegalTable({
  head,
  rows,
  label,
}: {
  head: string[];
  rows: ReactNode[][];
  label: string;
}) {
  return (
    <div className="overflow-x-auto" tabIndex={0} role="region" aria-label={label}>
      <table className="w-full min-w-[34rem] border-collapse text-left text-sm">
        <thead>
          <tr className="border-b border-surface-200">
            {head.map((cell) => (
              <th key={cell} scope="col" className="py-2 pr-4 font-semibold text-surface-900">
                {cell}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, rowIndex) => (
            <tr key={rowIndex} className="border-b border-surface-100 align-top">
              {row.map((cell, cellIndex) => (
                <td key={cellIndex} className="py-2 pr-4">
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
