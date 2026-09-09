'use client';

import Link from 'next/link';
import { type ReactNode } from 'react';
import { BetaSignalPlanner } from '@/components/beta-signal-planner';
import { LandingProductShowcase } from '@/components/landing-product-showcase';
import { SiteHeader } from '@/components/site-header';
import { useAuth } from '@/lib/auth-context';
import { getDashboardPath } from '@/lib/auth-routing';

const privacyCards = [
  {
    eyebrow: 'Never collected',
    title: 'The work stays yours',
    detail:
      'No source code, prompts, completions, terminal output, file contents, repository names, secrets, or environment variables.',
    tone: 'quiet',
  },
  {
    eyebrow: 'Only evidence used',
    title: 'The signal stays narrow',
    detail:
      'Ateva uses consent, session and request identifiers, render and visibility events, timestamps, and abuse controls.',
    tone: 'accent',
  },
] as const;

function ScrollReveal({
  children,
  className = '',
}: {
  children: ReactNode;
  className?: string;
  delay?: number;
  initiallyVisible?: boolean;
}) {
  return <div className={className}>{children}</div>;
}

function SignalPreview() {
  return (
    <figure className="landing-wait-preview">
      <div className="landing-wait-preview__offset" aria-hidden="true" />
      <div className="landing-wait-preview__surface">
        <div className="landing-wait-preview__header">
          <div className="flex min-w-0 items-center gap-2.5">
            <span className="landing-wait-preview__mark" aria-hidden="true">
              A
            </span>
            <span className="truncate font-mono text-[10px] uppercase tracking-[0.12em]">
              Ateva / integrated app
            </span>
          </div>
          <span className="landing-wait-preview__mode">Opt-in surface</span>
        </div>

        <div className="landing-wait-preview__body">
          <div className="landing-wait-preview__private">
            <span className="landing-wait-preview__label">Private work</span>
            <div className="landing-wait-preview__redactions" aria-hidden="true">
              <span />
              <span />
              <span />
              <span />
            </div>
            <p>The task stays in the app.</p>
          </div>

          <div className="landing-wait-preview__wait">
            <span className="landing-wait-preview__label">Eligible wait</span>
            <div className="landing-wait-preview__message">
              <span className="landing-wait-preview__activity-label">
                Agent is working
                <span className="landing-wait-preview__activity" aria-hidden="true">
                  <span />
                  <span />
                  <span />
                </span>
              </span>
              <strong>Awaiting a tool response</strong>
              <p>A useful surface can appear here while the person waits.</p>
            </div>
            <div className="landing-wait-preview__sponsor">
              <div>
                <span>Sponsored message</span>
                <span>Illustrative</span>
              </div>
              <strong>A clearly labelled message in the eligible wait.</strong>
              <span>Dismissible by the person waiting</span>
            </div>
          </div>
        </div>

        <figcaption className="landing-wait-preview__footer">
          <span>No source code</span>
          <span>No prompts</span>
          <span>No terminal output</span>
        </figcaption>
      </div>
    </figure>
  );
}

function PrimaryButton({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link href={href} className="landing-button landing-button--primary">
      {children}
      <span aria-hidden="true">→</span>
    </Link>
  );
}

function SecondaryButton({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link href={href} className="landing-button landing-button--secondary">
      {children}
    </Link>
  );
}

export default function HomePage() {
  const { isAuthenticated, user } = useAuth();
  const dashboardPath = user ? getDashboardPath(user.role) : '/developer';
  const primaryHref = isAuthenticated ? dashboardPath : '/auth/signup?role=developer';
  const primaryLabel = isAuthenticated ? 'Open dashboard' : 'Join developer beta';

  return (
    <div className="landing-page min-h-screen text-surface-950 antialiased">
      <SiteHeader
        primaryHref={primaryHref}
        primaryLabel={isAuthenticated ? 'Open dashboard' : 'Join developer beta'}
        primaryShortLabel={isAuthenticated ? 'Dashboard' : 'Join beta'}
        showLogin={!isAuthenticated}
        showThemeToggle
      />

      <main id="main-content" tabIndex={-1}>
        <section className="landing-hero landing-anchor overflow-hidden px-5 sm:px-6 lg:px-8">
          <div className="landing-container relative grid gap-14 lg:grid-cols-[minmax(0,0.96fr)_minmax(420px,0.84fr)] lg:items-center lg:gap-20">
            <ScrollReveal initiallyVisible className="landing-hero-copy">
              <p className="landing-hero-status landing-hero-copy__status">
                <span aria-hidden="true" className="landing-hero-status__dot" />
                Private beta <span aria-hidden="true">·</span> rewards off
              </p>

              <p className="landing-kicker landing-hero-copy__kicker mt-8">
                A delivery layer for AI-agent apps
              </p>
              <h1 className="landing-display landing-type-display landing-hero-title mt-4 max-w-[720px] text-balance text-surface-950">
                Give eligible waits a useful surface{' '}
                <span className="landing-hero-title__emphasis">and a record you can trust.</span>
              </h1>
              <p className="landing-type-body landing-hero-copy__body mt-7 max-w-[630px] text-base leading-7 text-surface-600 sm:text-lg sm:leading-8">
                Ateva gives explicitly integrated AI-agent apps a small, clearly labelled sponsor
                surface during eligible waits and measures whether it was delivered. The task stays
                outside the product, while rewards and campaign billing remain off during the beta.
              </p>

              <div className="landing-hero-copy__actions mt-9 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
                <PrimaryButton href={primaryHref}>{primaryLabel}</PrimaryButton>
                <SecondaryButton href="/advertisers">Join sponsor waitlist</SecondaryButton>
              </div>

              <div className="landing-proof-strip landing-hero-copy__proof mt-10 max-w-[680px]">
                <span>Opt-in integrations</span>
                <span>No code or prompts</span>
                <span>Measurement before money</span>
              </div>
            </ScrollReveal>

            <ScrollReveal
              initiallyVisible
              delay={120}
              className="landing-hero-preview lg:justify-self-end"
            >
              <SignalPreview />
            </ScrollReveal>
          </div>
        </section>

        <section
          id="product"
          className="landing-section landing-product-section landing-anchor px-5 sm:px-6 lg:px-8"
        >
          <div className="landing-container">
            <ScrollReveal>
              <LandingProductShowcase />
            </ScrollReveal>
          </div>
        </section>

        <section id="developers" className="landing-section landing-anchor px-5 sm:px-6 lg:px-8">
          <div className="landing-container">
            <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(360px,0.72fr)] lg:items-start lg:gap-20">
              <ScrollReveal>
                <div>
                  <p className="landing-eyebrow text-brand-600">For the beta</p>
                  <h2 className="landing-display landing-section-title mt-4 max-w-3xl text-balance text-surface-950">
                    Measure delivery before rewards or billing.
                  </h2>
                  <p className="landing-type-body mt-6 max-w-2xl text-base leading-7 text-surface-600">
                    The first job is measurement: can an integrated app create a useful,
                    privacy-safe wait surface, and can Ateva verify that it was delivered? The beta
                    answers that before rewards or live campaign billing exist.
                  </p>
                </div>
              </ScrollReveal>

              <ScrollReveal delay={110}>
                <aside className="landing-card landing-beta-card" aria-label="Current beta status">
                  <div>
                    <p className="landing-eyebrow">Current mode</p>
                    <p className="landing-type-subhead mt-2 text-lg font-semibold leading-7 tracking-[-0.015em] text-surface-950">
                      Measurement only
                    </p>
                  </div>
                  <div className="mt-7 grid grid-cols-2 gap-3">
                    <div className="landing-status-cell">
                      <strong>Off</strong>
                      <span>Rewards</span>
                    </div>
                    <div className="landing-status-cell">
                      <strong>Off</strong>
                      <span>Campaign billing</span>
                    </div>
                    <div className="landing-status-cell">
                      <strong>Opt in</strong>
                      <span>App participation</span>
                    </div>
                    <div className="landing-status-cell">
                      <strong>Narrow</strong>
                      <span>Data collected</span>
                    </div>
                  </div>
                  <p className="landing-type-caption mt-5 border-t border-surface-200/80 pt-4 text-xs leading-5 text-surface-500">
                    No payout promise is being made during this phase.
                  </p>
                </aside>
              </ScrollReveal>
            </div>

            <div className="landing-reveal-group mt-10 grid gap-4 md:grid-cols-2">
              <article className="landing-card landing-audience-card h-full">
                <p className="landing-eyebrow text-brand-600">Developers</p>
                <h3 className="landing-type-card-title mt-5 max-w-md text-xl font-semibold leading-7 tracking-[-0.02em] text-surface-950 sm:text-2xl sm:leading-8">
                  Give an app a privacy-safe surface for waiting.
                </h3>
                <p className="landing-type-detail mt-4 max-w-md text-sm leading-6 text-surface-600">
                  Join with an explicitly integrated client. Ateva sees consent and delivery
                  evidence, never what the agent is working on.
                </p>
                <Link href={primaryHref} className="landing-inline-link mt-7">
                  {isAuthenticated ? 'Open dashboard' : 'Join developer beta'} <span>→</span>
                </Link>
              </article>

              <article id="sponsors" className="landing-card landing-audience-card h-full">
                <p className="landing-eyebrow text-brand-600">Sponsors</p>
                <h3 className="landing-type-card-title mt-5 max-w-md text-xl font-semibold leading-7 tracking-[-0.02em] text-surface-950 sm:text-2xl sm:leading-8">
                  Reach builders in a moment they can actually see.
                </h3>
                <p className="landing-type-detail mt-4 max-w-md text-sm leading-6 text-surface-600">
                  Founding sponsors can prepare clearly labelled campaigns for an inventory that is
                  measured at delivery. Billing remains closed in the beta.
                </p>
                <Link href="/advertisers" className="landing-inline-link mt-7">
                  Join the sponsor waitlist <span>→</span>
                </Link>
              </article>
            </div>
          </div>
        </section>

        <section
          id="trust"
          className="landing-section landing-section--soft landing-anchor px-5 sm:px-6 lg:px-8"
        >
          <div className="landing-container">
            <div className="grid gap-10 lg:grid-cols-[0.72fr_1.28fr] lg:gap-20">
              <ScrollReveal>
                <div>
                  <p className="landing-eyebrow text-brand-600">Trust boundary</p>
                  <h2 className="landing-display landing-type-display landing-section-title mt-4 max-w-xl text-balance text-surface-950">
                    Ateva measures delivery, not the work.
                  </h2>
                  <p className="landing-type-body mt-6 max-w-lg text-base leading-7 text-surface-600">
                    The useful thing Ateva can measure is the delivery event. Everything about the
                    task behind it stays outside the product.
                  </p>
                </div>
              </ScrollReveal>

              <div className="landing-reveal-group grid gap-4 sm:grid-cols-2">
                {privacyCards.map((card) => (
                  <article
                    key={card.eyebrow}
                    className={`landing-card landing-privacy-card landing-privacy-card--${card.tone} h-full`}
                  >
                    <p className="landing-eyebrow landing-card-eyebrow">{card.eyebrow}</p>
                    <h3 className="landing-type-card-title mt-5 text-xl font-semibold leading-7 tracking-[-0.02em] text-surface-950 sm:text-2xl sm:leading-8">
                      {card.title}
                    </h3>
                    <p className="landing-type-detail mt-3 text-sm leading-6 text-surface-600">
                      {card.detail}
                    </p>
                  </article>
                ))}
              </div>
            </div>

            <ScrollReveal delay={220} className="mt-10">
              <div className="flex flex-wrap gap-x-6 gap-y-3 border-t border-surface-200/80 pt-6">
                <Link href="/privacy" className="landing-inline-link">
                  Privacy policy <span>→</span>
                </Link>
                <Link href="/advertiser-policy" className="landing-inline-link">
                  Advertiser policy <span>→</span>
                </Link>
                <Link href="/payout-policy" className="landing-inline-link">
                  Payout policy <span>→</span>
                </Link>
              </div>
            </ScrollReveal>
          </div>
        </section>

        <section className="landing-section landing-anchor px-5 sm:px-6 lg:px-8">
          <div className="landing-container">
            <ScrollReveal>
              <div className="flex flex-col justify-between gap-5 sm:flex-row sm:items-end">
                <div>
                  <p className="landing-eyebrow text-brand-600">Optional sandbox</p>
                  <h2 className="landing-display landing-type-display landing-section-title landing-section-title--compact mt-4 max-w-2xl text-balance text-surface-950">
                    See the signal in context.
                  </h2>
                  <p className="landing-type-body mt-5 max-w-xl text-base leading-7 text-surface-600">
                    Explore an illustrative day or campaign. It is a planning aid, not a payout
                    forecast, and nothing is billed during the beta.
                  </p>
                </div>
                <p className="landing-eyebrow landing-sandbox-meta m-0">
                  Illustrative planning aid
                </p>
              </div>
            </ScrollReveal>

            <ScrollReveal delay={100} className="mt-10">
              <BetaSignalPlanner />
            </ScrollReveal>
          </div>
        </section>

        <section className="landing-section landing-section--cta px-5 sm:px-6 lg:px-8">
          <div className="landing-container">
            <ScrollReveal>
              <div className="landing-cta-card">
                <div>
                  <p className="landing-eyebrow text-brand-300">Private beta</p>
                  <h2 className="landing-display landing-type-display landing-section-title landing-section-title--light mt-4 max-w-2xl text-balance text-white">
                    Help validate the product in private beta.
                  </h2>
                  <p className="landing-type-body landing-type-body--inverse mt-5 max-w-xl text-base leading-7 text-white/75">
                    Join as a developer or register interest as a founding sponsor. The current
                    phase is about evidence, consent, and trust.
                  </p>
                </div>
                <div className="flex flex-col gap-3 sm:flex-row">
                  <Link href={primaryHref} className="landing-button landing-button--light">
                    {primaryLabel} <span aria-hidden="true">→</span>
                  </Link>
                  <Link href="/advertisers" className="landing-button landing-button--dark-outline">
                    Sponsor waitlist
                  </Link>
                </div>
              </div>
            </ScrollReveal>
          </div>
        </section>
      </main>
    </div>
  );
}
