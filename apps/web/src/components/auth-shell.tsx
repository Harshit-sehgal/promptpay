import Link from 'next/link';
import type { ReactNode } from 'react';

import { BrandMark } from './brand-mark';
import { PalettePicker } from './palette-picker';
import { PageBackdrop } from './site-header';

export function AuthShell({ children }: { children: ReactNode }) {
  return (
    <main
      id="main-content"
      tabIndex={-1}
      className="auth-shell flex min-h-screen items-center justify-center px-4 py-8 sm:px-6 lg:px-8"
    >
      <PageBackdrop />
      <div className="auth-shell__frame grid w-full max-w-[1120px] overflow-hidden lg:grid-cols-[.9fr_1.1fr]">
        <aside className="auth-shell__aside relative hidden min-h-[720px] overflow-hidden p-12 lg:flex lg:flex-col lg:justify-between">
          <Link
            href="/"
            aria-label="Ateva home"
            className="relative inline-flex w-fit items-center gap-2.5 rounded-full"
          >
            <span className="auth-shell__mark grid h-9 w-9 place-items-center rounded-full">
              <BrandMark size={17} />
            </span>
            <span className="text-[15px] font-semibold tracking-[-0.02em]">Ateva</span>
          </Link>

          <div className="relative my-14">
            <p className="auth-shell__quiet font-mono text-[11px] font-medium uppercase tracking-[0.15em]">
              Account access
            </p>
            <p className="mt-5 max-w-md text-balance font-serif text-[52px] font-normal leading-[1.02] tracking-[-0.03em]">
              A clear path into <em className="font-normal italic">your Ateva workspace.</em>
            </p>

            <div className="auth-shell__aside-artifact mt-10 border-t pt-5">
              <div className="flex items-baseline justify-between gap-4">
                <p className="auth-shell__quiet font-mono text-[11px] uppercase tracking-[0.14em]">
                  Privacy boundary
                </p>
                <span className="auth-shell__quiet text-[11px]">Explicit opt-in</span>
              </div>
              <p className="mt-4 max-w-sm font-serif text-2xl font-normal leading-tight">
                Your work is never used as product data.
              </p>
              <div className="auth-shell__quiet mt-5 grid gap-2 border-t pt-4 font-mono text-[11px] uppercase tracking-[0.12em]">
                <span>No source code</span>
                <span>No prompts</span>
                <span>No terminal output</span>
              </div>
            </div>
          </div>

          <p className="auth-shell__quiet relative font-mono text-[11px] uppercase tracking-[0.14em]">
            Private beta · rewards disabled
          </p>
        </aside>

        <div className="auth-shell__content relative flex min-h-[640px] flex-col items-center justify-center p-5 sm:p-10 lg:p-14">
          <div className="auth-shell__toolbar">
            <PalettePicker />
          </div>
          <Link
            href="/"
            aria-label="Ateva home"
            className="auth-shell__mobile-brand mb-8 inline-flex items-center gap-2.5 rounded-full lg:hidden"
          >
            <span className="auth-shell__mark grid h-9 w-9 place-items-center rounded-full">
              <BrandMark size={17} />
            </span>
            <span className="text-[15px] font-semibold tracking-[-0.02em]">Ateva</span>
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
