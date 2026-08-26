'use client';

import Link from 'next/link';
import { BackendStatus } from '@/components/backend-status';
import { BetaSignalPlanner } from '@/components/beta-signal-planner';
import { SiteHeader } from '@/components/site-header';
import { useAuth } from '@/lib/auth-context';
import { getDashboardPath } from '@/lib/auth-routing';

const verificationSteps = [
  {
    title: 'Eligible wait begins',
    detail: 'The integration records a qualifying pause with explicit consent.',
  },
  {
    title: 'Sponsored unit renders',
    detail: 'The unit must appear in the eligible session—not merely be requested.',
  },
  {
    title: 'Visibility checks pass',
    detail: 'Session, duration, duplicate, and fraud controls are evaluated.',
  },
  {
    title: 'Delivery is recorded',
    detail: 'Only a qualified impression reaches the reporting ledger.',
  },
];

const betaGuarantees = [
  'Rewards are disabled during the private beta; nothing accrues yet.',
  'If enabled, Ateva would record a participant obligation equal to 60% of each qualifying bid and retain 40%.',
  'The participant share is an Ateva obligation—not a claim on the advertiser payment.',
  'Future payouts use a separately approved fiat provider, never Dodo Payments.',
];

function VerificationTrace() {
  return (
    <figure className="relative mx-auto w-full max-w-[540px] lg:mx-0 lg:ml-auto">
      <div
        aria-hidden="true"
        className="absolute -bottom-5 -right-5 h-[78%] w-[82%] rounded-[32px] bg-brand-100/70 sm:-bottom-7 sm:-right-7"
      />
      <div className="relative overflow-hidden rounded-[28px] border border-surface-200/80 bg-white p-5 shadow-[0_1px_2px_rgba(23,25,28,0.04),0_24px_70px_-32px_rgba(23,25,28,0.28)] sm:p-7">
        <div className="flex items-center justify-between gap-4 border-b border-surface-200/80 pb-5">
          <div>
            <p className="font-mono text-[10px] font-medium uppercase tracking-[0.15em] text-surface-400">
              Verification trace
            </p>
            <p className="mt-1.5 text-sm font-medium text-surface-900">Illustrative agent wait</p>
          </div>
          <span className="inline-flex items-center gap-2 rounded-full border border-emerald-200/80 bg-emerald-50 px-3 py-1.5 text-[11px] font-medium text-emerald-800">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />4 / 4 checks
          </span>
        </div>

        <div className="relative mt-6 space-y-5">
          <div
            aria-hidden="true"
            className="absolute bottom-3 left-[5px] top-3 w-px bg-surface-200"
          />

          <div className="relative grid grid-cols-[12px_1fr_auto] items-start gap-x-4">
            <span className="relative z-10 mt-1.5 h-3 w-3 rounded-full border-[3px] border-white bg-surface-950 ring-1 ring-surface-300" />
            <div>
              <p className="text-[13px] font-medium text-surface-900">Eligible wait detected</p>
              <p className="mt-1 text-xs leading-5 text-surface-500">Agent is running tests.</p>
            </div>
            <time className="font-mono text-[10px] text-surface-400">00:00.0</time>
          </div>

          <div className="relative grid grid-cols-[12px_1fr_auto] items-start gap-x-4">
            <span className="relative z-10 mt-1.5 h-3 w-3 rounded-full border-[3px] border-white bg-brand-500 ring-1 ring-brand-300" />
            <div className="rounded-2xl bg-brand-200 p-4 text-brand-900">
              <p className="font-mono text-[9px] font-medium uppercase tracking-[0.14em] text-brand-700">
                Sponsored · example
              </p>
              <p className="mt-2 text-[14px] font-medium leading-5">
                Developer infrastructure for AI-native teams
              </p>
              <p className="mt-2 text-[11px] leading-4 text-brand-700">
                Clearly labelled inside the eligible waiting surface.
              </p>
            </div>
            <time className="font-mono text-[10px] text-surface-400">00:05.2</time>
          </div>

          <div className="relative grid grid-cols-[12px_1fr_auto] items-start gap-x-4">
            <span className="relative z-10 mt-1.5 h-3 w-3 rounded-full border-[3px] border-white bg-emerald-500 ring-1 ring-emerald-300" />
            <div>
              <p className="text-[13px] font-medium text-surface-900">Visibility verified</p>
              <p className="mt-1 text-xs leading-5 text-surface-500">
                Duration, session, and duplicate controls passed.
              </p>
            </div>
            <time className="font-mono text-[10px] text-surface-400">00:10.8</time>
          </div>

          <div className="relative grid grid-cols-[12px_1fr_auto] items-start gap-x-4">
            <span className="relative z-10 mt-1.5 h-3 w-3 rounded-full border-[3px] border-white bg-surface-950 ring-1 ring-surface-300" />
            <div>
              <p className="text-[13px] font-medium text-surface-900">
                Qualified impression recorded
              </p>
              <p className="mt-1 text-xs leading-5 text-surface-500">
                Reporting only; reward settlement remains disabled.
              </p>
            </div>
            <time className="font-mono text-[10px] text-surface-400">00:11.0</time>
          </div>
        </div>

        <figcaption className="mt-6 flex flex-wrap gap-x-4 gap-y-1 border-t border-surface-200/80 pt-4 font-mono text-[9px] uppercase tracking-[0.12em] text-surface-400">
          <span>No source code</span>
          <span>No prompts</span>
          <span>No terminal output</span>
        </figcaption>
      </div>
    </figure>
  );
}

export default function HomePage() {
  const { isAuthenticated, user } = useAuth();
  const dashboardPath = user ? getDashboardPath(user.role) : '/developer';
  const primaryHref = isAuthenticated ? dashboardPath : '/auth/signup?role=developer';
  const primaryLabel = isAuthenticated ? 'Dashboard' : 'Join beta';

  return (
    <div className="min-h-screen bg-white text-surface-950 antialiased">
      <SiteHeader
        primaryHref={primaryHref}
        primaryLabel={primaryLabel}
        showLogin={!isAuthenticated}
      />

      <main id="main-content" tabIndex={-1}>
        <section className="relative overflow-hidden border-b border-surface-200/75 px-5 py-16 sm:px-6 sm:py-20 lg:px-8 lg:py-24">
          <div
            aria-hidden="true"
            className="absolute right-[4%] top-[8%] h-80 w-80 rounded-full bg-brand-50 blur-3xl"
          />
          <div className="relative mx-auto grid max-w-[1240px] gap-16 lg:grid-cols-[minmax(0,1.08fr)_minmax(420px,.92fr)] lg:items-center xl:gap-20">
            <div>
              <div className="mb-7 flex flex-wrap items-center gap-2.5">
                <span className="inline-flex items-center gap-2 rounded-full border border-brand-300/80 bg-brand-100 px-3.5 py-1.5 font-mono text-[10px] font-medium uppercase tracking-[0.13em] text-brand-800">
                  <span className="h-1.5 w-1.5 rounded-full bg-brand-500" />
                  Private beta · rewards disabled
                </span>
                <BackendStatus />
              </div>

              <h1 className="max-w-[780px] text-balance font-serif text-[clamp(3.35rem,7vw,5.8rem)] font-normal leading-[0.95] tracking-[-0.04em] text-surface-950">
                Verify AI-agent wait time{' '}
                <em className="font-normal italic text-brand-600">without reading</em> the work.
              </h1>
              <p className="mt-7 max-w-[650px] text-[17px] leading-7 text-surface-600 sm:text-lg sm:leading-8">
                Ateva lets explicitly integrated AI-agent applications show a small, clearly
                labelled sponsored unit during eligible waiting periods. The beta validates
                measurement and fraud controls before rewards or live campaign billing are enabled.
              </p>

              <div className="mt-9 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
                <Link
                  href={primaryHref}
                  className="inline-flex h-12 items-center justify-center rounded-full bg-surface-950 px-7 text-sm font-medium text-white transition-transform duration-200 hover:-translate-y-0.5 hover:bg-surface-800 motion-reduce:transform-none motion-reduce:transition-none"
                >
                  {isAuthenticated ? 'Open dashboard' : 'Join developer beta'}
                  <span aria-hidden="true" className="ml-2">
                    →
                  </span>
                </Link>
                <Link
                  href={
                    isAuthenticated && user?.role === 'advertiser' ? '/advertiser' : '/advertisers'
                  }
                  className="inline-flex h-12 items-center justify-center rounded-full border border-surface-900 px-7 text-sm font-medium text-surface-950 transition-colors hover:bg-surface-100/70"
                >
                  Review advertiser tooling
                </Link>
              </div>

              <div className="mt-10 grid max-w-[690px] gap-y-3 border-t border-surface-200/80 pt-5 font-mono text-[10px] uppercase tracking-[0.09em] text-surface-500 sm:grid-cols-3 sm:gap-x-5">
                <span>Integrated apps only</span>
                <span>Explicit consent</span>
                <span>Separate payment rails</span>
              </div>
            </div>

            <VerificationTrace />
          </div>
        </section>

        <section
          id="how-it-works"
          className="border-b border-surface-200/75 bg-surface-50 px-5 py-20 sm:px-6 lg:px-8 lg:py-28"
        >
          <div className="mx-auto max-w-[1240px]">
            <div className="grid gap-8 lg:grid-cols-[.72fr_1.28fr] lg:gap-16">
              <p className="font-mono text-[10px] font-medium uppercase tracking-[0.15em] text-brand-600">
                Verification, not self-reporting
              </p>
              <div>
                <h2 className="max-w-4xl text-balance font-serif text-[clamp(2.7rem,5vw,4.4rem)] font-normal leading-[1.02] tracking-[-0.03em] text-surface-950">
                  A view counts only after it passes every check.
                </h2>
                <p className="mt-6 max-w-2xl text-base leading-7 text-surface-600">
                  The integration records the sponsored unit only when it is actually rendered in an
                  eligible session. A participant cannot declare a view on their own.
                </p>
              </div>
            </div>

            <ol className="mt-14 grid border-y border-surface-300/70 md:grid-cols-4 md:divide-x md:divide-surface-300/70">
              {verificationSteps.map((step, index) => (
                <li
                  key={step.title}
                  className="border-b border-surface-300/70 py-6 last:border-b-0 md:border-b-0 md:px-6 md:first:pl-0 md:last:pr-0"
                >
                  <p className="font-mono text-[10px] text-brand-600">
                    {String(index + 1).padStart(2, '0')} / 04
                  </p>
                  <h3 className="mt-5 text-sm font-semibold text-surface-900">{step.title}</h3>
                  <p className="mt-2 text-[13px] leading-5 text-surface-500">{step.detail}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section
          id="developers"
          className="border-b border-surface-200/75 px-5 py-20 sm:px-6 lg:px-8 lg:py-28"
        >
          <div className="mx-auto max-w-[1240px]">
            <div className="grid gap-10 lg:grid-cols-[.9fr_1.1fr] lg:items-start lg:gap-20">
              <div>
                <p className="font-mono text-[10px] font-medium uppercase tracking-[0.15em] text-brand-600">
                  For developers
                </p>
                <h2 className="mt-4 max-w-xl text-balance font-serif text-[clamp(2.7rem,5vw,4.25rem)] font-normal leading-[1.02] tracking-[-0.03em] text-surface-950">
                  Validate the signal before money enters the picture.
                </h2>
                <p className="mt-6 max-w-xl text-base leading-7 text-surface-600">
                  The beta measures eligible wait states with explicit consent. Nothing accrues
                  while rewards are off. If enabled, Ateva would record a participant obligation
                  equal to 60% of each qualifying bid and retain 40%.
                </p>
              </div>

              <div className="rounded-[28px] border border-surface-200/80 bg-surface-50 p-6 sm:p-8">
                <div className="flex items-end justify-between gap-5 border-b border-surface-200 pb-6">
                  <div>
                    <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-surface-500">
                      Future qualifying split
                    </p>
                    <p className="mt-2 font-serif text-4xl tracking-[-0.03em] text-surface-950">
                      60 <span className="text-surface-300">/</span> 40
                    </p>
                  </div>
                  <p className="max-w-[180px] text-right text-xs leading-5 text-surface-500">
                    Participant obligation / Ateva
                  </p>
                </div>
                <ul className="mt-6 space-y-4">
                  {betaGuarantees.map((guarantee) => (
                    <li
                      key={guarantee}
                      className="grid grid-cols-[18px_1fr] gap-3 text-[13px] leading-5 text-surface-600"
                    >
                      <span aria-hidden="true" className="mt-1 h-2 w-2 rounded-full bg-brand-500" />
                      <span>{guarantee}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>

            <BetaSignalPlanner />
          </div>
        </section>

        <section id="sponsors" className="px-5 py-20 sm:px-6 lg:px-8 lg:py-28">
          <div className="mx-auto max-w-[1240px] overflow-hidden rounded-[32px] bg-surface-950 px-6 py-10 text-white sm:px-10 sm:py-14 lg:px-14 lg:py-16">
            <div className="grid gap-12 lg:grid-cols-[1.02fr_.98fr] lg:items-end lg:gap-20">
              <div>
                <p className="font-mono text-[10px] font-medium uppercase tracking-[0.15em] text-brand-300">
                  For advertisers
                </p>
                <h2 className="mt-4 max-w-2xl text-balance font-serif text-[clamp(2.7rem,5vw,4.35rem)] font-normal leading-[1.02] tracking-[-0.03em]">
                  Buy verified delivery, with the money rails kept separate.
                </h2>
              </div>
              <p className="max-w-xl text-sm leading-6 text-white/58 lg:pb-1">
                Dodo Payments processes the advertiser transaction and settles it to Ateva in full.
                Any future participant compensation is a separate Ateva expense, calculated only
                after verification and paid through a different provider.
              </p>
            </div>

            <div className="mt-12 grid gap-px overflow-hidden rounded-3xl border border-white/12 bg-white/12 md:grid-cols-2">
              <div className="bg-surface-950 p-6 sm:p-8">
                <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-white/55">
                  Customer payment
                </p>
                <p className="mt-5 text-lg font-medium text-white">
                  Advertiser <span className="px-1 text-brand-300">→</span> Dodo Payments{' '}
                  <span className="px-1 text-brand-300">→</span> Ateva
                </p>
                <p className="mt-3 text-[13px] leading-5 text-white/50">
                  The complete customer transaction settles to Ateva.
                </p>
              </div>
              <div className="bg-surface-950 p-6 sm:p-8">
                <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-white/55">
                  Future participant payout
                </p>
                <p className="mt-5 text-lg font-medium text-white">
                  Ateva <span className="px-1 text-brand-300">→</span> approved provider{' '}
                  <span className="px-1 text-brand-300">→</span> participant
                </p>
                <p className="mt-3 text-[13px] leading-5 text-white/50">
                  A separate fiat obligation after verification and approval.
                </p>
              </div>
            </div>
          </div>
        </section>

        <section
          id="trust"
          className="border-y border-surface-200/75 bg-surface-50 px-5 py-20 sm:px-6 lg:px-8 lg:py-28"
        >
          <div className="mx-auto grid max-w-[1240px] gap-12 lg:grid-cols-[.88fr_1.12fr] lg:gap-20">
            <div>
              <p className="font-mono text-[10px] font-medium uppercase tracking-[0.15em] text-brand-600">
                Trust boundary
              </p>
              <h2 className="mt-4 max-w-lg text-balance font-serif text-[clamp(2.8rem,5vw,4.4rem)] font-normal leading-[1] tracking-[-0.03em] text-surface-950">
                Measure the wait. Leave the work alone.
              </h2>
              <p className="mt-6 max-w-lg text-base leading-7 text-surface-600">
                Ateva needs evidence that a sponsored unit was visible—not access to what the agent
                or developer was doing.
              </p>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="rounded-[26px] border border-surface-200/80 bg-white p-6 sm:p-7">
                <span className="inline-flex rounded-full border border-surface-200 px-3 py-1 font-mono text-[9px] uppercase tracking-[0.13em] text-surface-500">
                  Never required
                </span>
                <p className="mt-6 text-sm font-semibold text-surface-950">The work itself</p>
                <p className="mt-3 text-[13px] leading-6 text-surface-500">
                  Source code · prompts · completions · terminal output · file contents · repository
                  names · secrets · environment variables
                </p>
              </div>
              <div className="rounded-[26px] border border-brand-300/80 bg-white p-6 sm:p-7">
                <span className="inline-flex rounded-full bg-brand-100 px-3 py-1 font-mono text-[9px] uppercase tracking-[0.13em] text-brand-700">
                  Narrow evidence
                </span>
                <p className="mt-6 text-sm font-semibold text-surface-950">The delivery trace</p>
                <p className="mt-3 text-[13px] leading-6 text-surface-500">
                  Session and request identifiers · eligible duration · render and visibility events
                  · timestamps · duplicate controls · fraud signals
                </p>
              </div>
            </div>
          </div>

          <div className="mx-auto mt-10 flex max-w-[1240px] flex-wrap gap-x-6 gap-y-3 border-t border-surface-200/80 pt-6">
            <Link href="/privacy" className="wl-link-u text-sm font-medium text-brand-700">
              Privacy policy →
            </Link>
            <Link
              href="/advertiser-policy"
              className="wl-link-u text-sm font-medium text-brand-700"
            >
              Advertiser policy →
            </Link>
            <Link href="/payout-policy" className="wl-link-u text-sm font-medium text-brand-700">
              Payout policy →
            </Link>
          </div>
        </section>

        <section className="px-5 py-20 sm:px-6 lg:px-8 lg:py-24">
          <div className="mx-auto flex max-w-[1240px] flex-col justify-between gap-8 border-b border-surface-200 pb-16 md:flex-row md:items-end">
            <div>
              <p className="font-mono text-[10px] font-medium uppercase tracking-[0.15em] text-brand-600">
                Private beta
              </p>
              <h2 className="mt-4 max-w-3xl text-balance font-serif text-[clamp(2.7rem,5vw,4.2rem)] font-normal leading-[1.02] tracking-[-0.03em] text-surface-950">
                Help prove the signal before the incentives switch on.
              </h2>
            </div>
            <div className="flex flex-col gap-3 sm:flex-row md:justify-end">
              <Link
                href={primaryHref}
                className="inline-flex h-12 items-center justify-center rounded-full bg-surface-950 px-7 text-sm font-medium text-white hover:bg-surface-800"
              >
                {isAuthenticated ? 'Open dashboard' : 'Join developer beta'}
              </Link>
              <Link
                href="/advertisers"
                className="inline-flex h-12 items-center justify-center rounded-full border border-surface-900 px-7 text-sm font-medium text-surface-950 hover:bg-surface-100/70"
              >
                Join advertiser waitlist
              </Link>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
