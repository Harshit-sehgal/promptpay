'use client';

import Link from 'next/link';
import type { CSSProperties, ReactNode } from 'react';
import { useEffect, useRef, useState } from 'react';
import { BetaSignalPlanner } from '@/components/beta-signal-planner';
import { LandingProductShowcase } from '@/components/landing-product-showcase';
import { SiteHeader } from '@/components/site-header';
import { useAuth } from '@/lib/auth-context';
import { getDashboardPath } from '@/lib/auth-routing';

import { MINIMUM_VISIBLE_DURATION_MS, MINIMUM_VISIBLE_SURFACE_PERCENT } from '@ateva/shared';

const visibleFloorSeconds = (MINIMUM_VISIBLE_DURATION_MS / 1000).toFixed(2);

const verificationCards = [
  {
    label: 'Eligibility',
    title: 'The app marks a real pause',
    detail: 'An explicitly integrated app signals an eligible wait with the person’s consent.',
  },
  {
    label: 'Delivery',
    title: 'A labelled unit actually renders',
    detail: 'The sponsored message appears inside that waiting surface, not just in a request log.',
  },
  {
    label: 'Verification',
    title: 'Evidence agrees before it counts',
    detail: 'Duration, visible surface, duplicate, session, and fraud checks are evaluated first.',
  },
] as const;

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
  delay = 0,
}: {
  children: ReactNode;
  className?: string;
  delay?: number;
}) {
  const [visible, setVisible] = useState(false);
  const revealRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const element = revealRef.current;
    if (!element) return;

    const prefersReducedMotion =
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    if (prefersReducedMotion || !('IntersectionObserver' in window)) {
      setVisible(true);
      return;
    }

    let hasRevealed = false;
    const show = () => {
      if (hasRevealed) return;
      hasRevealed = true;
      setVisible(true);
      observer.disconnect();
      window.removeEventListener('scroll', revealOnScroll);
    };
    const revealOnScroll = () => {
      if (element.getBoundingClientRect().top < window.innerHeight * 0.92) show();
    };
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting) return;
        show();
      },
      { threshold: 0.14, rootMargin: '0px 0px -8% 0px' },
    );

    observer.observe(element);
    window.addEventListener('scroll', revealOnScroll, { passive: true });
    revealOnScroll();
    return () => {
      observer.disconnect();
      window.removeEventListener('scroll', revealOnScroll);
    };
  }, []);

  const revealStyle = { '--reveal-delay': `${delay}ms` } as CSSProperties;

  return (
    <div
      ref={revealRef}
      className={`landing-reveal ${visible ? 'landing-reveal--visible' : ''} ${className}`}
      style={revealStyle}
    >
      {children}
    </div>
  );
}

function SignalPreview() {
  return (
    <figure className="landing-card landing-signal-card">
      <div className="flex items-start justify-between gap-4 border-b border-surface-200/80 pb-5">
        <div>
          <p className="landing-eyebrow">Signal preview</p>
          <p className="mt-2 text-sm font-semibold text-surface-950">One eligible delivery</p>
        </div>
        <span className="landing-chip landing-chip--quiet">Illustrative</span>
      </div>

      <div className="landing-signal-canvas">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <span aria-hidden="true" className="landing-signal-dot" />
            <div>
              <p className="text-sm font-semibold text-surface-950">Eligible surface</p>
              <p className="mt-1 text-xs text-surface-500">Consent recorded by the app</p>
            </div>
          </div>
          <span className="landing-status-tag">Ready</span>
        </div>

        <div className="landing-sponsored-unit">
          <div className="flex items-center justify-between gap-3">
            <span className="landing-eyebrow text-brand-700">Sponsored message</span>
            <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-brand-700/70">
              Example
            </span>
          </div>
          <p className="mt-5 max-w-[280px] font-serif text-[30px] leading-[1.02] tracking-[-0.03em] text-brand-900">
            Make the next build feel lighter.
          </p>
          <p className="mt-3 max-w-[300px] text-xs leading-5 text-brand-800/75">
            A clearly labelled message while an eligible agent wait is visible.
          </p>
        </div>

        <div className="grid grid-cols-2 divide-x divide-surface-200/80 border-t border-surface-200/80 pt-5">
          <div className="pr-4">
            <p className="landing-eyebrow text-surface-500">Visibility floor</p>
            <p className="mt-2 text-sm font-semibold text-surface-950">{visibleFloorSeconds}s</p>
          </div>
          <div className="pl-4">
            <p className="landing-eyebrow text-surface-500">Surface check</p>
            <p className="mt-2 text-sm font-semibold text-surface-950">
              {MINIMUM_VISIBLE_SURFACE_PERCENT}% when reported
            </p>
          </div>
        </div>
      </div>

      <figcaption className="mt-5 border-t border-surface-200/80 pt-4 text-xs leading-5 text-surface-500">
        Delivery evidence only. No source code, prompts, or terminal output.
      </figcaption>
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
        primaryLabel={isAuthenticated ? 'Dashboard' : 'Join beta'}
        showLogin={!isAuthenticated}
      />

      <main id="main-content" tabIndex={-1}>
        <section className="landing-hero landing-anchor overflow-hidden px-5 sm:px-6 lg:px-8">
          <div aria-hidden="true" className="landing-hero-orb" />
          <div className="landing-container relative grid gap-14 lg:grid-cols-[minmax(0,0.96fr)_minmax(420px,0.84fr)] lg:items-center lg:gap-20">
            <ScrollReveal>
              <div className="flex flex-wrap items-center gap-2.5">
                <span className="landing-chip landing-chip--accent">
                  <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-brand-500" />
                  Private beta
                </span>
                <span className="landing-chip landing-chip--quiet">Rewards off</span>
              </div>

              <p className="landing-kicker mt-8">
                A privacy-first delivery layer for AI-agent apps
              </p>
              <h1 className="landing-display landing-hero-title mt-4 max-w-[720px] text-balance text-surface-950">
                Verify AI-agent wait time{' '}
                <em className="font-normal italic text-brand-600">without reading the work.</em>
              </h1>
              <p className="mt-7 max-w-[630px] text-[17px] leading-7 text-surface-600 sm:text-lg sm:leading-8">
                Ateva gives explicitly integrated AI-agent apps a small, clearly labelled sponsor
                surface during eligible waits. Delivery is verified without inspecting the task
                itself. Rewards and campaign billing stay off while the beta proves the signal.
              </p>

              <div className="mt-9 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
                <PrimaryButton href={primaryHref}>{primaryLabel}</PrimaryButton>
                <SecondaryButton href="/advertisers">For sponsors</SecondaryButton>
              </div>

              <div className="landing-proof-strip mt-10 max-w-[680px]">
                <span>Opt-in integrations</span>
                <span>No code or prompts</span>
                <span>Measurement before money</span>
              </div>
            </ScrollReveal>

            <ScrollReveal delay={120} className="lg:justify-self-end">
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

        <section
          id="how-it-works"
          className="landing-section landing-section--soft landing-anchor px-5 sm:px-6 lg:px-8"
        >
          <div className="landing-container">
            <ScrollReveal>
              <div className="landing-section-heading grid gap-7 lg:grid-cols-[0.72fr_1.28fr] lg:gap-16">
                <p className="landing-eyebrow text-brand-600">How it works</p>
                <div>
                  <h2 className="landing-display landing-section-title max-w-3xl text-balance text-surface-950">
                    One signal. Three checks. No access to the work.
                  </h2>
                  <p className="mt-6 max-w-2xl text-base leading-7 text-surface-600">
                    Ateva only needs to know that a consented, labelled unit appeared and stayed
                    visible long enough to be meaningful.
                  </p>
                </div>
              </div>
            </ScrollReveal>

            <div className="mt-12 grid gap-4 md:grid-cols-3">
              {verificationCards.map((card, index) => (
                <ScrollReveal key={card.label} delay={index * 90} className="h-full">
                  <article className="landing-card landing-process-card h-full">
                    <div className="flex items-center justify-between gap-4">
                      <span className="landing-step-number">0{index + 1}</span>
                      <span className="landing-eyebrow text-surface-500">{card.label}</span>
                    </div>
                    <h3 className="mt-14 max-w-[250px] text-lg font-semibold leading-6 text-surface-950">
                      {card.title}
                    </h3>
                    <p className="mt-3 text-[13px] leading-6 text-surface-600">{card.detail}</p>
                  </article>
                </ScrollReveal>
              ))}
            </div>

            <ScrollReveal delay={280} className="mt-6">
              <div className="landing-note-strip">
                <span className="landing-note-label">What reaches reporting</span>
                <span>
                  Qualified delivery evidence — not a self-reported view and not a balance.
                </span>
              </div>
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
                    Validate the signal before money enters the picture.
                  </h2>
                  <p className="mt-6 max-w-2xl text-base leading-7 text-surface-600">
                    The first job is measurement: can an integrated app create a useful,
                    privacy-safe wait surface, and can Ateva verify that it was delivered? The beta
                    answers that before rewards or live campaign billing exist.
                  </p>
                </div>
              </ScrollReveal>

              <ScrollReveal delay={110}>
                <aside className="landing-card landing-beta-card" aria-label="Current beta status">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="landing-eyebrow">Current mode</p>
                      <p className="mt-2 text-lg font-semibold text-surface-950">
                        Measurement only
                      </p>
                    </div>
                    <span className="landing-chip landing-chip--accent">Live beta</span>
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
                  <p className="mt-5 border-t border-surface-200/80 pt-4 text-xs leading-5 text-surface-500">
                    No payout promise is being made during this phase.
                  </p>
                </aside>
              </ScrollReveal>
            </div>

            <div className="mt-10 grid gap-4 md:grid-cols-2">
              <ScrollReveal className="h-full">
                <article className="landing-card landing-audience-card h-full">
                  <p className="landing-eyebrow text-brand-600">Developers</p>
                  <h3 className="mt-5 max-w-md text-2xl font-semibold leading-tight tracking-[-0.025em] text-surface-950">
                    Give an app a privacy-safe surface for waiting.
                  </h3>
                  <p className="mt-4 max-w-md text-sm leading-6 text-surface-600">
                    Join with an explicitly integrated client. Ateva sees consent and delivery
                    evidence, never what the agent is working on.
                  </p>
                  <Link href={primaryHref} className="landing-inline-link mt-7">
                    {isAuthenticated ? 'Open dashboard' : 'Join developer beta'} <span>→</span>
                  </Link>
                </article>
              </ScrollReveal>

              <ScrollReveal delay={100} className="h-full">
                <article id="sponsors" className="landing-card landing-audience-card h-full">
                  <p className="landing-eyebrow text-brand-600">Sponsors</p>
                  <h3 className="mt-5 max-w-md text-2xl font-semibold leading-tight tracking-[-0.025em] text-surface-950">
                    Reach builders in a moment they can actually see.
                  </h3>
                  <p className="mt-4 max-w-md text-sm leading-6 text-surface-600">
                    Founding sponsors can prepare clearly labelled campaigns for an inventory that
                    is measured at delivery. Billing remains closed in the beta.
                  </p>
                  <Link href="/advertisers" className="landing-inline-link mt-7">
                    Join the sponsor waitlist <span>→</span>
                  </Link>
                </article>
              </ScrollReveal>
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
                  <h2 className="landing-display landing-section-title mt-4 max-w-xl text-balance text-surface-950">
                    Privacy is the product boundary.
                  </h2>
                  <p className="mt-6 max-w-lg text-base leading-7 text-surface-600">
                    The useful thing Ateva can measure is the delivery event. Everything about the
                    task behind it stays outside the product.
                  </p>
                </div>
              </ScrollReveal>

              <div className="grid gap-4 sm:grid-cols-2">
                {privacyCards.map((card, index) => (
                  <ScrollReveal key={card.eyebrow} delay={index * 100} className="h-full">
                    <article
                      className={`landing-card landing-privacy-card landing-privacy-card--${card.tone} h-full`}
                    >
                      <span className="landing-chip landing-chip--quiet">{card.eyebrow}</span>
                      <h3 className="mt-7 text-lg font-semibold text-surface-950">{card.title}</h3>
                      <p className="mt-3 text-[13px] leading-6 text-surface-600">{card.detail}</p>
                    </article>
                  </ScrollReveal>
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
                  <h2 className="landing-display landing-section-title landing-section-title--compact mt-4 max-w-2xl text-balance text-surface-950">
                    See the signal in context.
                  </h2>
                  <p className="mt-5 max-w-xl text-sm leading-6 text-surface-600">
                    Explore an illustrative day or campaign. It is a planning aid, not a payout
                    forecast, and nothing is billed during the beta.
                  </p>
                </div>
                <span className="landing-chip landing-chip--quiet">Illustrative only</span>
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
                  <h2 className="landing-display landing-section-title landing-section-title--light mt-4 max-w-2xl text-balance text-white">
                    Help prove the signal before the incentives switch on.
                  </h2>
                  <p className="mt-5 max-w-xl text-sm leading-6 text-white/65">
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
