import Link from 'next/link';
import type { ReactNode } from 'react';

import { BrandMark } from './brand-mark';

export function AuthShell({ children }: { children: ReactNode }) {
  return (
    <main
      id="main-content"
      tabIndex={-1}
      className="flex min-h-screen items-center justify-center bg-surface-50 px-4 py-8 sm:px-6 lg:px-8"
    >
      <div className="grid w-full max-w-[1120px] overflow-hidden rounded-[32px] border border-surface-200/80 bg-white shadow-[0_1px_2px_rgba(23,25,28,0.03),0_30px_90px_-48px_rgba(23,25,28,0.32)] lg:grid-cols-[.9fr_1.1fr]">
        <aside className="relative hidden min-h-[720px] overflow-hidden bg-surface-950 p-12 text-white lg:flex lg:flex-col lg:justify-between">
          <div
            aria-hidden="true"
            className="absolute -right-24 top-20 h-72 w-72 rounded-full bg-brand-500/18 blur-3xl"
          />
          <Link
            href="/"
            aria-label="Ateva home"
            className="relative inline-flex w-fit items-center gap-2.5 rounded-full focus-visible:ring-2 focus-visible:ring-brand-300 focus-visible:ring-offset-4 focus-visible:ring-offset-surface-950"
          >
            <span className="grid h-9 w-9 place-items-center rounded-full bg-white text-surface-950">
              <BrandMark size={17} />
            </span>
            <span className="text-[15px] font-semibold tracking-[-0.02em]">Ateva</span>
          </Link>

          <div className="relative my-14">
            <p className="font-mono text-[10px] font-medium uppercase tracking-[0.15em] text-brand-300">
              The account boundary
            </p>
            <p className="mt-5 max-w-md text-balance font-serif text-[52px] font-normal leading-[1.02] tracking-[-0.03em]">
              The wait is measured.{' '}
              <em className="font-normal italic text-brand-300">The work stays private.</em>
            </p>

            <div className="mt-10 rounded-3xl border border-white/12 bg-white/[0.045] p-6">
              <div className="flex items-center justify-between border-b border-white/10 pb-4">
                <p className="font-mono text-[9px] uppercase tracking-[0.14em] text-white/55">
                  Eligible session
                </p>
                <span className="inline-flex items-center gap-2 text-[10px] text-emerald-300">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                  Verified
                </span>
              </div>
              <div className="mt-4 rounded-2xl bg-brand-200 p-4 text-brand-900">
                <p className="font-mono text-[9px] uppercase tracking-[0.13em] text-brand-700">
                  Sponsored · example
                </p>
                <p className="mt-2 text-sm font-medium">Clearly labelled inside the wait.</p>
              </div>
              <div className="mt-4 flex flex-wrap gap-x-4 gap-y-1 font-mono text-[8px] uppercase tracking-[0.12em] text-white/55">
                <span>No source code</span>
                <span>No prompts</span>
                <span>No terminal output</span>
              </div>
            </div>
          </div>

          <p className="relative font-mono text-[9px] uppercase tracking-[0.14em] text-white/55">
            Private beta · rewards disabled
          </p>
        </aside>

        <div className="flex min-h-[640px] items-center justify-center p-5 sm:p-10 lg:p-14">
          {children}
        </div>
      </div>
    </main>
  );
}
