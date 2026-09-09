import Link from 'next/link';
import type { ReactNode } from 'react';

import { BrandMark } from './brand-mark';
import { ThemeToggle } from './theme-toggle';

export function AuthShell({ children }: { children: ReactNode }) {
  return (
    <main
      id="main-content"
      tabIndex={-1}
      className="auth-shell flex min-h-screen items-center justify-center bg-surface-50 px-4 py-8 sm:px-6 lg:px-8"
    >
      <div className="auth-shell__frame grid w-full max-w-[1120px] overflow-hidden rounded-[24px] border border-surface-200/80 bg-white shadow-[0_1px_2px_rgba(23,25,28,0.03),0_30px_90px_-48px_rgba(23,25,28,0.32)] lg:grid-cols-[.9fr_1.1fr]">
        <aside className="auth-shell__aside relative hidden min-h-[720px] overflow-hidden bg-surface-950 p-12 text-white lg:flex lg:flex-col lg:justify-between">
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
            <p className="font-mono text-[11px] font-medium uppercase tracking-[0.15em] text-brand-300">
              Account access
            </p>
            <p className="mt-5 max-w-md text-balance font-serif text-[52px] font-normal leading-[1.02] tracking-[-0.03em]">
              A clear path into{' '}
              <em className="font-normal italic text-brand-300">your Ateva workspace.</em>
            </p>

            <div className="auth-shell__aside-artifact mt-10 border-t border-white/12 pt-5">
              <div className="flex items-baseline justify-between gap-4">
                <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-white/55">
                  Privacy boundary
                </p>
                <span className="text-[11px] text-white/55">Explicit opt-in</span>
              </div>
              <p className="mt-4 max-w-sm font-serif text-2xl font-normal leading-tight text-white">
                Your work is never used as product data.
              </p>
              <div className="mt-5 grid gap-2 border-t border-white/10 pt-4 font-mono text-[11px] uppercase tracking-[0.12em] text-white/55">
                <span>No source code</span>
                <span>No prompts</span>
                <span>No terminal output</span>
              </div>
            </div>
          </div>

          <p className="relative font-mono text-[11px] uppercase tracking-[0.14em] text-white/55">
            Private beta · rewards disabled
          </p>
        </aside>

        <div className="auth-shell__content relative flex min-h-[640px] flex-col items-center justify-center p-5 sm:p-10 lg:p-14">
          <div className="auth-shell__toolbar">
            <ThemeToggle />
          </div>
          <Link
            href="/"
            aria-label="Ateva home"
            className="auth-shell__mobile-brand mb-8 inline-flex items-center gap-2.5 rounded-full lg:hidden"
          >
            <span className="grid h-9 w-9 place-items-center rounded-full bg-surface-950 text-white">
              <BrandMark size={17} />
            </span>
            <span className="text-[15px] font-semibold tracking-[-0.02em] text-surface-950">
              Ateva
            </span>
          </Link>
          <div className="w-full">{children}</div>
          <nav aria-label="Account support links" className="auth-shell__legal">
            <Link href="/privacy">Privacy</Link>
            <Link href="/terms">Terms</Link>
            <Link href="/legal/cookie-policy">Cookie policy</Link>
          </nav>
        </div>
      </div>
    </main>
  );
}
