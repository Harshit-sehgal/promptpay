'use client';

import Link from 'next/link';
import { BackendStatus } from '@/components/backend-status';
import { BetaSignalPlanner } from '@/components/beta-signal-planner';
import { BrandMark } from '@/components/brand-mark';
import { useAuth } from '@/lib/auth-context';
import { getDashboardPath } from '@/lib/auth-routing';

const verificationSteps = [
  'Eligible wait state detected',
  'Sponsored unit actually rendered',
  'Visibility and session checks pass',
  'Duplicate and fraud controls pass',
  'Qualified impression recorded',
];

export default function HomePage() {
  const { isAuthenticated, user } = useAuth();
  const dashboardPath = user ? getDashboardPath(user.role) : '/developer';

  return (
    <div className="min-h-screen bg-white text-surface-950 antialiased">
      <header className="sticky top-0 z-50 border-b border-surface-200/80 bg-white/90 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-[1180px] items-center justify-between px-6 lg:px-8">
          <Link
            href="/"
            className="flex items-center gap-2.5 rounded focus-visible:ring-2 focus-visible:ring-brand-600"
          >
            <BrandMark />
            <span className="text-base font-semibold tracking-tight">Ateva</span>
          </Link>

          <nav className="hidden items-center gap-8 text-sm text-surface-600 md:flex">
            <a href="#how-it-works" className="hover:text-surface-950">
              How it works
            </a>
            <a href="#developers" className="hover:text-surface-950">
              Developers
            </a>
            <a href="#sponsors" className="hover:text-surface-950">
              Sponsors
            </a>
            <a href="#trust" className="hover:text-surface-950">
              Trust
            </a>
            <Link href="/pricing" className="hover:text-surface-950">
              Pricing
            </Link>
          </nav>

          <div className="flex items-center gap-2">
            {!isAuthenticated && (
              <Link
                href="/auth/login"
                className="hidden px-3 py-2 text-sm font-medium text-surface-600 sm:inline-flex"
              >
                Log in
              </Link>
            )}
            <Link
              href={isAuthenticated ? dashboardPath : '/auth/signup?role=developer'}
              className="inline-flex h-9 items-center rounded-lg bg-surface-950 px-4 text-sm font-medium text-white hover:bg-surface-800"
            >
              {isAuthenticated ? 'Dashboard' : 'Join beta'}
            </Link>
          </div>
        </div>
      </header>

      <main id="main-content" tabIndex={-1}>
        <section className="border-b border-surface-200 px-6 py-20 md:py-28">
          <div className="mx-auto grid max-w-[1180px] gap-14 lg:grid-cols-[1.05fr_.95fr] lg:items-center">
            <div>
              <div className="mb-6 flex flex-wrap items-center gap-3">
                <span className="inline-flex items-center gap-2 rounded-full border border-amber-200 bg-amber-50 px-3 py-1.5 font-mono text-[11px] font-medium uppercase tracking-wider text-amber-800">
                  <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
                  Private beta · rewards disabled
                </span>
                <BackendStatus />
              </div>

              <h1 className="max-w-3xl font-serif text-5xl font-normal leading-[1.04] tracking-tight text-surface-950 md:text-6xl">
                Verify AI-agent wait time without reading the work.
              </h1>
              <p className="mt-6 max-w-2xl text-lg leading-relaxed text-surface-600">
                Ateva lets explicitly integrated AI-agent applications show a small, clearly labeled
                sponsored unit during eligible waiting periods. The beta is validating the
                measurement and fraud controls before any reward or live campaign billing is
                enabled.
              </p>

              <div className="mt-8 flex flex-wrap gap-3">
                <Link
                  href={isAuthenticated ? dashboardPath : '/auth/signup?role=developer'}
                  className="inline-flex h-12 items-center rounded-lg bg-surface-950 px-6 text-sm font-semibold text-white"
                >
                  {isAuthenticated ? 'Open dashboard' : 'Join developer beta'}
                </Link>
                {/*
                  Signed-out advertisers go to the waitlist, not signup. Billing
                  is closed, so inviting someone to create an account they cannot
                  yet spend through is a dead end; `/advertisers` captures the
                  interest instead. An advertiser who already has an account
                  still lands on their dashboard.
                */}
                <Link
                  href={
                    isAuthenticated && user?.role === 'advertiser' ? '/advertiser' : '/advertisers'
                  }
                  className="inline-flex h-12 items-center rounded-lg border border-surface-300 px-6 text-sm font-semibold text-surface-800"
                >
                  Review advertiser tooling
                </Link>
              </div>

              <div className="mt-7 flex flex-wrap gap-x-5 gap-y-2 font-mono text-xs text-surface-500">
                <span>Designed for integrated AI-agent workflows</span>
                <span>No source code, prompts, or terminal output</span>
                <span>Participant rewards are separate from advertiser billing</span>
              </div>
            </div>

            <div className="rounded-2xl border border-surface-200 bg-surface-950 p-6 text-white shadow-xl">
              <div className="mb-5 flex items-center justify-between border-b border-white/10 pb-4 font-mono text-xs text-white/50">
                <span>illustrative agent wait</span>
                <span>beta telemetry</span>
              </div>
              <div className="font-mono text-sm leading-7 text-white/80">
                <p>
                  <span className="text-white/60">agent</span> running tests…
                </p>
                <div className="my-5 rounded-lg border border-white/10 bg-white/[0.04] p-4">
                  <p className="text-[11px] uppercase tracking-wider text-white/60">
                    Sponsored · example
                  </p>
                  <p className="mt-1 font-sans text-base font-medium text-white">
                    Developer infrastructure for AI-native teams
                  </p>
                </div>
                <p className="text-emerald-400">✓ rendered in eligible session</p>
                <p className="text-emerald-400">✓ visibility + duplicate checks passed</p>
                <p className="mt-4 text-white/50">qualified impression → reporting ledger</p>
                <p className="text-amber-300">reward settlement → disabled in private beta</p>
              </div>
            </div>
          </div>
        </section>

        <section
          id="how-it-works"
          className="border-b border-surface-200 bg-surface-50/70 px-6 py-20"
        >
          <div className="mx-auto max-w-[1180px]">
            <div className="max-w-2xl">
              <p className="font-mono text-xs uppercase tracking-widest text-surface-500">
                Verification
              </p>
              <h2 className="mt-3 font-serif text-4xl text-surface-950">
                A view counts only after it passes the checks.
              </h2>
              <p className="mt-4 leading-relaxed text-surface-600">
                A verified impression is recorded by the integration when the sponsored unit is
                actually rendered in an eligible session. It is not a participant self-report.
              </p>
            </div>
            <div className="mt-10 grid gap-4 md:grid-cols-5">
              {verificationSteps.map((step, index) => (
                <div key={step} className="rounded-xl border border-surface-200 bg-white p-5">
                  <p className="font-mono text-xs text-brand-700">0{index + 1}</p>
                  <p className="mt-3 text-sm font-medium leading-relaxed text-surface-800">
                    {step}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section id="developers" className="border-b border-surface-200 px-6 py-20">
          <div className="mx-auto grid max-w-[1180px] gap-10 md:grid-cols-2">
            <div>
              <p className="font-mono text-xs uppercase tracking-widest text-surface-500">
                For developers
              </p>
              <h2 className="mt-3 font-serif text-4xl text-surface-950">
                Validate the signal first.
              </h2>
              <p className="mt-5 max-w-xl leading-relaxed text-surface-600">
                The beta measures eligible wait states with explicit consent. Nothing accrues while
                rewards are off. When they are enabled, a verified impression splits{' '}
                <strong className="font-semibold text-surface-900">60% to you</strong> and 40% to
                Ateva, and that 60% is paid in fiat on a published schedule — never in a token, and
                never as a claim on the advertiser&rsquo;s payment itself.
              </p>
            </div>
            <div className="rounded-2xl border border-surface-200 bg-surface-50 p-7">
              <p className="text-sm font-semibold text-surface-900">Beta guarantees</p>
              <ul className="mt-5 space-y-3 text-sm text-surface-600">
                <li>✓ Rewards are not currently enabled — nothing accrues yet.</li>
                <li>✓ When they are, verified impressions split 60% to you, 40% to Ateva.</li>
                <li>
                  ✓ Your 60% is an Ateva obligation, not a share of the advertiser&rsquo;s payment.
                </li>
                <li>✓ Payouts use a separately approved fiat provider — never Dodo Payments.</li>
              </ul>
            </div>
          </div>
          <BetaSignalPlanner />
        </section>

        <section
          id="sponsors"
          className="border-b border-surface-200 bg-surface-950 px-6 py-20 text-white"
        >
          <div className="mx-auto max-w-[1180px]">
            <div className="max-w-3xl">
              <p className="font-mono text-xs uppercase tracking-widest text-white/50">
                For advertisers
              </p>
              <h2 className="mt-3 font-serif text-4xl">
                Buy verified campaign delivery from Ateva.
              </h2>
              <p className="mt-5 leading-relaxed text-white/65">
                The planned advertiser flow is straightforward: the advertiser pays Ateva for
                campaign delivery; Dodo Payments processes that customer transaction and settles it
                to Ateva in full. Participant compensation is then a separate Ateva expense —
                calculated after verification at 60% of the qualifying bid and paid through a
                different provider. The two never touch the same rail.
              </p>
            </div>
            <div className="mt-10 grid gap-5 md:grid-cols-2">
              <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-7">
                <p className="font-mono text-xs uppercase tracking-wider text-white/60">Money in</p>
                <p className="mt-3 text-xl font-semibold">Advertiser → Dodo Payments → Ateva</p>
                <p className="mt-3 text-sm leading-relaxed text-white/55">
                  The full customer transaction settles to Ateva. Nothing is diverted mid-payment.
                </p>
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-7">
                <p className="font-mono text-xs uppercase tracking-wider text-white/60">
                  Future money out
                </p>
                <p className="mt-3 text-xl font-semibold">
                  Ateva → separate payout provider → participant
                </p>
                <p className="mt-3 text-sm leading-relaxed text-white/55">
                  60% of the qualifying bid, as fiat Ateva owes — paid only after the payout rail
                  and reward program are approved.
                </p>
              </div>
            </div>
          </div>
        </section>

        <section id="trust" className="px-6 py-20">
          <div className="mx-auto max-w-[1180px]">
            <div className="max-w-2xl">
              <p className="font-mono text-xs uppercase tracking-widest text-surface-500">
                Trust boundary
              </p>
              <h2 className="mt-3 font-serif text-4xl text-surface-950">
                Measure the wait, not the work.
              </h2>
            </div>
            <div className="mt-10 grid gap-5 md:grid-cols-2">
              <div className="rounded-2xl border border-rose-100 bg-rose-50/60 p-7">
                <p className="font-semibold text-surface-900">Never required for an impression</p>
                <p className="mt-4 text-sm leading-7 text-surface-600">
                  Source code · prompts · completions · terminal output · file contents · repository
                  names · secrets or environment variables
                </p>
              </div>
              <div className="rounded-2xl border border-emerald-100 bg-emerald-50/60 p-7">
                <p className="font-semibold text-surface-900">Narrow verification data</p>
                <p className="mt-4 text-sm leading-7 text-surface-600">
                  Session/request identifiers · eligible duration · render/visibility events ·
                  timestamps · duplicate controls · fraud signals · campaign identifiers
                </p>
              </div>
            </div>
            <div className="mt-8 flex flex-wrap gap-4">
              <Link href="/privacy" className="text-sm font-semibold text-brand-700">
                Privacy policy →
              </Link>
              <Link href="/advertiser-policy" className="text-sm font-semibold text-brand-700">
                Advertiser policy →
              </Link>
              <Link href="/payout-policy" className="text-sm font-semibold text-brand-700">
                Payout policy →
              </Link>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
