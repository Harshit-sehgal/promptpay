'use client';

import { useState } from 'react';

import { MINIMUM_VISIBLE_DURATION_MS, MINIMUM_VISIBLE_SURFACE_PERCENT } from '@ateva/shared';

type ProductViewId = 'app' | 'developer' | 'sponsor';

interface ProductView {
  id: ProductViewId;
  label: string;
  eyebrow: string;
  title: string;
  detail: string;
  facts: Array<{ label: string; value: string }>;
}

const visibleFloor = `${(MINIMUM_VISIBLE_DURATION_MS / 1000).toFixed(2)}s`;

const PRODUCT_VIEWS: ProductView[] = [
  {
    id: 'app',
    label: 'In the app',
    eyebrow: 'The placement',
    title: 'A small sponsor surface inside the wait.',
    detail:
      'The integrated app keeps the work area private and gives the person a clear, dismissible message while an eligible wait is visible.',
    facts: [
      { label: 'Appears', value: 'Inside an eligible wait surface' },
      { label: 'Shows', value: 'A labelled sponsored message' },
      { label: 'Never reads', value: 'Code, prompts, or terminal output' },
    ],
  },
  {
    id: 'developer',
    label: 'Developer view',
    eyebrow: 'The controls',
    title: 'A clear record of what was measured.',
    detail:
      'Developers choose whether to participate, when to stay quiet, and how many units their app may show. The beta records evidence, not a payout balance.',
    facts: [
      { label: 'Control', value: 'Opt in, quiet hours, and category blocks' },
      { label: 'Evidence', value: 'Consent, render, visibility, and session checks' },
      { label: 'Current mode', value: 'Telemetry only · rewards off' },
    ],
  },
  {
    id: 'sponsor',
    label: 'Sponsor view',
    eyebrow: 'The campaign',
    title: 'A message prepared for a measured moment.',
    detail:
      'Sponsors define the message and campaign rules. Review happens before delivery, and billing stays closed until the beta proves the inventory.',
    facts: [
      { label: 'Inventory', value: 'Eligible AI-agent wait surfaces' },
      { label: 'Review', value: 'Creative and delivery checks required' },
      { label: 'Current mode', value: 'Campaign billing off' },
    ],
  },
];

function WindowTopbar({ label, status }: { label: string; status: string }) {
  return (
    <div className="landing-window-topbar">
      <div className="flex items-center gap-2.5">
        <span aria-hidden="true" className="landing-window-mark">
          A
        </span>
        <span className="font-mono text-[10px] font-medium uppercase tracking-[0.12em] text-surface-700">
          {label}
        </span>
      </div>
      <span className="landing-window-status">{status}</span>
    </div>
  );
}

function FakeNavigation({ items, active }: { items: string[]; active: string }) {
  return (
    <nav aria-hidden="true" className="landing-fake-navigation">
      {items.map((item) => (
        <span key={item} className={item === active ? 'is-active' : ''}>
          {item}
        </span>
      ))}
    </nav>
  );
}

function AppSurfacePreview() {
  return (
    <div
      role="img"
      aria-label="Illustrative Ateva placement inside an AI-agent application"
      className="landing-product-window landing-product-window--app"
    >
      <WindowTopbar
        label="Ateva integration / agent workspace"
        status="Illustrative product view"
      />

      <div className="landing-app-layout">
        <aside className="landing-app-rail" aria-hidden="true">
          <span className="landing-app-rail__label">Workspace</span>
          <span className="landing-app-rail__item is-active">Builds</span>
          <span className="landing-app-rail__item">Agent</span>
          <span className="landing-app-rail__item">Signals</span>
          <div className="landing-app-rail__rule" />
          <span className="landing-app-rail__item">Settings</span>
        </aside>

        <div className="landing-app-workspace">
          <div className="landing-app-workspace__header">
            <div>
              <span className="landing-product-overline">Agent workspace</span>
              <strong>Build 184</strong>
            </div>
            <span className="landing-mini-status landing-mini-status--quiet">Private task</span>
          </div>

          <div className="landing-app-content">
            <div className="landing-private-work" aria-hidden="true">
              <span className="landing-product-overline">The work stays here</span>
              <div className="landing-redacted-lines">
                <span className="w-[86%]" />
                <span className="w-[63%]" />
                <span className="w-[74%]" />
                <span className="w-[48%]" />
                <span className="w-[68%]" />
                <span className="w-[56%]" />
              </div>
              <p>Task details remain in the integrated app.</p>
            </div>

            <div className="landing-wait-surface">
              <div className="flex items-center justify-between gap-3">
                <span className="landing-mini-status landing-mini-status--active">
                  <span aria-hidden="true" className="landing-mini-status__dot" />
                  Eligible wait
                </span>
                <span className="landing-product-overline">Consent recorded</span>
              </div>

              <div className="landing-wait-center">
                <span aria-hidden="true" className="landing-wait-orbit" />
                <span className="landing-product-overline">Agent is working</span>
                <strong>Awaiting a tool response</strong>
                <span>Keep this surface visible to qualify the delivery.</span>
              </div>

              <div className="landing-ad-placement">
                <div className="flex items-center justify-between gap-3">
                  <span className="landing-ad-label">Sponsored message</span>
                  <span className="landing-ad-example">Example</span>
                </div>
                <strong>Make the next build feel lighter.</strong>
                <div className="flex items-center justify-between gap-3">
                  <span>Clearly labelled inside the wait</span>
                  <span className="landing-ad-dismiss">Dismiss</span>
                </div>
              </div>
            </div>
          </div>

          <div className="landing-window-legend">
            <span>Wait surface</span>
            <span>{visibleFloor} minimum visible duration</span>
            <span>{MINIMUM_VISIBLE_SURFACE_PERCENT}% surface when reported</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function DeveloperViewPreview() {
  return (
    <div
      role="img"
      aria-label="Illustrative Ateva developer dashboard showing signal controls and evidence"
      className="landing-product-window landing-product-window--dashboard"
    >
      <WindowTopbar label="Ateva / developer dashboard" status="Measurement only" />

      <div className="landing-dashboard-layout">
        <FakeNavigation items={['Overview', 'Earnings', 'Trust', 'Settings']} active="Overview" />
        <div className="landing-dashboard-main">
          <div className="landing-dashboard-heading">
            <div>
              <span className="landing-product-overline">Developer</span>
              <strong>Your integration</strong>
            </div>
            <span className="landing-mini-status landing-mini-status--active">Telemetry only</span>
          </div>

          <div className="landing-dashboard-stats">
            <div>
              <span>Participation</span>
              <strong>Opt in</strong>
              <small>Controlled by your app</small>
            </div>
            <div>
              <span>Rewards</span>
              <strong>Off</strong>
              <small>Nothing accrues in beta</small>
            </div>
            <div>
              <span>Ad limit</span>
              <strong>6 / hr</strong>
              <small>Your per-hour ceiling</small>
            </div>
          </div>

          <div className="landing-evidence-panel">
            <div className="flex items-center justify-between gap-3">
              <div>
                <span className="landing-product-overline">Evidence path</span>
                <strong>One delivery, checked in order</strong>
              </div>
              <span className="landing-mini-status landing-mini-status--quiet">Illustrative</span>
            </div>
            <div className="landing-evidence-list">
              {[
                ['01', 'Consent recorded', 'Ready'],
                ['02', 'Unit rendered', 'Ready'],
                ['03', 'Visibility checked', 'Ready'],
              ].map(([number, label, status]) => (
                <div key={number}>
                  <span className="landing-evidence-number">{number}</span>
                  <span>{label}</span>
                  <strong>{status}</strong>
                </div>
              ))}
            </div>
          </div>

          <div className="landing-dashboard-footer">
            <span>Quiet hours</span>
            <span>Blocked categories</span>
            <span>Data export</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function SponsorViewPreview() {
  return (
    <div
      role="img"
      aria-label="Illustrative Ateva sponsor workspace showing campaign review and a labelled creative"
      className="landing-product-window landing-product-window--sponsor"
    >
      <WindowTopbar label="Ateva / sponsor workspace" status="Billing closed in beta" />

      <div className="landing-sponsor-layout">
        <FakeNavigation
          items={['Overview', 'Campaigns', 'Reports', 'Billing']}
          active="Campaigns"
        />
        <div className="landing-sponsor-main">
          <div className="landing-dashboard-heading">
            <div>
              <span className="landing-product-overline">Campaign draft</span>
              <strong>Developer tools, right when work is moving.</strong>
            </div>
            <span className="landing-mini-status landing-mini-status--quiet">Needs review</span>
          </div>

          <div className="landing-sponsor-grid">
            <div className="landing-campaign-fields">
              <div>
                <span>Creative label</span>
                <strong>Sponsored message</strong>
              </div>
              <div>
                <span>Inventory</span>
                <strong>Eligible wait surfaces</strong>
              </div>
              <div>
                <span>Delivery proof</span>
                <strong>Required before billing</strong>
              </div>
              <div>
                <span>Campaign state</span>
                <strong>Preparing for beta review</strong>
              </div>
            </div>

            <div className="landing-creative-preview">
              <span className="landing-ad-label">Sponsored message</span>
              <strong>Make the next build feel lighter.</strong>
              <span>Shown only in a labelled, eligible wait surface.</span>
              <div className="landing-creative-preview__line" />
              <span className="landing-product-overline">No billing during beta</span>
            </div>
          </div>

          <div className="landing-sponsor-requirements">
            <span className="landing-product-overline">Before a message can run</span>
            <div>
              <span>Clear label</span>
              <span>Approved creative</span>
              <span>Verified delivery</span>
              <span>Budget available after launch</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function ProductViewPreview({ id }: { id: ProductViewId }) {
  if (id === 'developer') return <DeveloperViewPreview />;
  if (id === 'sponsor') return <SponsorViewPreview />;
  return <AppSurfacePreview />;
}

export function LandingProductShowcase() {
  const [activeId, setActiveId] = useState<ProductViewId>('app');
  const activeView = PRODUCT_VIEWS.find((view) => view.id === activeId) ?? PRODUCT_VIEWS[0];

  return (
    <div className="landing-product-showcase">
      <div className="landing-showcase-heading">
        <div>
          <p className="landing-eyebrow text-brand-300">Product preview</p>
          <h2 className="landing-display mt-4 max-w-4xl text-balance text-[clamp(2.8rem,5.7vw,5.4rem)] leading-[0.92] tracking-[-0.05em] text-white">
            See the signal where it actually lives.
          </h2>
        </div>
        <p className="max-w-md text-[15px] leading-7 text-white/62">
          One narrow product, three views: the in-app moment, the developer controls, and the
          sponsor workflow behind it.
        </p>
      </div>

      <div className="landing-showcase-tabs" role="tablist" aria-label="Ateva product views">
        {PRODUCT_VIEWS.map((view) => {
          const isActive = view.id === activeId;
          return (
            <button
              key={view.id}
              id={`product-tab-${view.id}`}
              type="button"
              role="tab"
              aria-selected={isActive}
              aria-controls="product-view-panel"
              tabIndex={isActive ? 0 : -1}
              onClick={() => setActiveId(view.id)}
              onKeyDown={(event) => {
                if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
                event.preventDefault();
                const currentIndex = PRODUCT_VIEWS.findIndex(
                  (candidate) => candidate.id === view.id,
                );
                const direction = event.key === 'ArrowRight' ? 1 : -1;
                const nextIndex =
                  (currentIndex + direction + PRODUCT_VIEWS.length) % PRODUCT_VIEWS.length;
                const nextView = PRODUCT_VIEWS[nextIndex];
                setActiveId(nextView.id);
                window.requestAnimationFrame(() => {
                  document.getElementById(`product-tab-${nextView.id}`)?.focus();
                });
              }}
              className={isActive ? 'is-active' : ''}
            >
              <span>{view.label}</span>
              <span aria-hidden="true">→</span>
            </button>
          );
        })}
      </div>

      <div className="landing-showcase-grid">
        <div
          id="product-view-panel"
          role="tabpanel"
          aria-label={activeView.label}
          aria-labelledby={`product-tab-${activeView.id}`}
          className="landing-product-stage"
        >
          <div key={activeView.id} className="landing-stage-view">
            <ProductViewPreview id={activeView.id} />
          </div>
        </div>

        <aside className="landing-showcase-aside">
          <p className="landing-eyebrow text-brand-300">{activeView.eyebrow}</p>
          <h3 className="landing-display mt-4 text-3xl leading-[0.98] tracking-[-0.035em] text-white sm:text-4xl">
            {activeView.title}
          </h3>
          <p className="mt-5 text-sm leading-6 text-white/62">{activeView.detail}</p>

          <dl className="landing-product-facts mt-8">
            {activeView.facts.map((fact) => (
              <div key={fact.label} className="landing-product-fact">
                <dt>{fact.label}</dt>
                <dd>{fact.value}</dd>
              </div>
            ))}
          </dl>
        </aside>
      </div>

      <div className="landing-showcase-footnote">
        <span className="landing-note-label text-brand-300">Placement rule</span>
        <span>
          A sponsor message belongs in the app&rsquo;s existing eligible wait surface — never over
          code, prompts, terminal output, or the developer&rsquo;s private task.
        </span>
      </div>
    </div>
  );
}
