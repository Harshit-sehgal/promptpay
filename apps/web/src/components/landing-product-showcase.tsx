'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { MINIMUM_VISIBLE_DURATION_MS, MINIMUM_VISIBLE_SURFACE_PERCENT } from '@ateva/shared';

export type VerificationStage = 'eligible' | 'sponsored' | 'visible' | 'verified' | 'qualified';

interface VerificationStageCopy {
  label: string;
  title: string;
  detail: string;
}

interface VerificationStageTransition {
  from: VerificationStage;
  to: VerificationStage;
}

const visibleFloor = `${(MINIMUM_VISIBLE_DURATION_MS / 1000).toFixed(2)}s`;

const VERIFICATION_STAGES: Array<{ id: VerificationStage; copy: VerificationStageCopy }> = [
  {
    id: 'eligible',
    copy: {
      label: 'Eligible wait',
      title: 'The integrated app marks a real pause.',
      detail:
        'The person has opted in and the app has identified a supported wait surface. The work stays in the app.',
    },
  },
  {
    id: 'sponsored',
    copy: {
      label: 'Sponsored unit',
      title: 'A labelled message appears inside the wait.',
      detail:
        'The placement is visible in context and clearly marked as sponsored. It is dismissible by the person waiting.',
    },
  },
  {
    id: 'visible',
    copy: {
      label: 'Visibility check',
      title: 'The delivery stays visible long enough to measure.',
      detail: `Ateva evaluates the ${visibleFloor} duration floor and the ${MINIMUM_VISIBLE_SURFACE_PERCENT}% visible-surface signal when it is reported.`,
    },
  },
  {
    id: 'verified',
    copy: {
      label: 'Evidence verified',
      title: 'The evidence is checked before it counts.',
      detail:
        'Session, duplicate, ordering, and abuse checks are evaluated alongside the delivery facts.',
    },
  },
  {
    id: 'qualified',
    copy: {
      label: 'Qualified delivery',
      title: 'A verified delivery becomes a reporting record.',
      detail:
        'The beta records the qualified event. Rewards and advertiser billing remain disabled while the signal is reviewed.',
    },
  },
];

const stageIndex = (stage: VerificationStage) =>
  VERIFICATION_STAGES.findIndex((candidate) => candidate.id === stage);

const VERIFICATION_BOUNDARY_PATH = 'M8 34C56 7 86 83 138 48S221 17 271 58s91 34 181-15';

// These points are sampled along the same curve used by the SVG. Keeping the
// marker inside the SVG means it stays on the line when the sketch scales down
// on a phone, rather than drifting like an absolutely-positioned HTML dot.
const VERIFICATION_BOUNDARY_POINTS = [
  { x: 8, y: 34 },
  { x: 121.39, y: 55.86 },
  { x: 233.54, y: 32.76 },
  { x: 339.72, y: 84.7 },
  { x: 452, y: 43 },
] as const;

const VERIFICATION_BOUNDARY_MOTION_DURATION = '0.42s';

function WindowLabel() {
  return (
    <div className="landing-verification-window__topbar">
      <div className="flex min-w-0 items-center gap-2.5">
        <span aria-hidden="true" className="landing-window-mark">
          A
        </span>
        <span className="truncate font-mono text-[10px] font-medium uppercase tracking-[0.12em]">
          Ateva / integrated app
        </span>
      </div>
    </div>
  );
}

function VerificationArtifact({
  stage,
  isUpdating,
}: {
  stage: VerificationStage;
  isUpdating: boolean;
}) {
  const copy = VERIFICATION_STAGES[stageIndex(stage)].copy;
  const currentIndex = stageIndex(stage);
  const hasPlacement = currentIndex >= stageIndex('sponsored');
  const hasVisibility = currentIndex >= stageIndex('visible');
  const isQualified = stage === 'qualified';

  return (
    <figure
      className={`landing-verification-artifact${isUpdating ? ' is-updating' : ''}`}
      data-verification-stage={stage}
      aria-label={`Illustrative Ateva wait surface: ${copy.label}`}
    >
      <WindowLabel />

      <div className="landing-verification-artifact__body">
        <div className="landing-verification-private-work" aria-hidden="true">
          <span className="landing-product-overline">Private work area</span>
          <div className="landing-redacted-lines">
            <span className="w-[86%]" />
            <span className="w-[63%]" />
            <span className="w-[74%]" />
            <span className="w-[48%]" />
            <span className="w-[68%]" />
          </div>
          <p>Task details stay in the integrated app.</p>
        </div>

        <div className="landing-verification-wait">
          <div className="flex items-center justify-between gap-3">
            <span className="landing-verification-state">{copy.label}</span>
            <span className="landing-product-overline">Opt-in surface</span>
          </div>

          <div className="landing-verification-wait__center">
            <span className="landing-product-overline">Agent is working</span>
            <strong>{isQualified ? 'Delivery qualified' : 'Awaiting a tool response'}</strong>
            <span>
              {hasVisibility ? 'The surface is being measured.' : 'The wait remains visible.'}
            </span>
          </div>

          {hasPlacement ? (
            <div className="landing-verification-sponsored">
              <div className="flex items-center justify-between gap-3">
                <span className="landing-verification-sponsored__label">Sponsored message</span>
                <span>Illustrative</span>
              </div>
              <strong>A clearly labelled message in the eligible wait.</strong>
              <div className="flex items-center justify-between gap-3">
                <span>Clearly labelled inside the wait</span>
                <span className="landing-verification-sponsored__dismiss">Dismiss</span>
              </div>
            </div>
          ) : (
            <div className="landing-verification-empty">
              <span>Placement appears only after an eligible wait is recorded.</span>
            </div>
          )}
        </div>
      </div>

      <div className="landing-verification-artifact__footer">
        <span>
          {hasVisibility ? `${visibleFloor} minimum visible duration` : 'Waiting for visibility'}
        </span>
        <span>
          {hasVisibility
            ? `${MINIMUM_VISIBLE_SURFACE_PERCENT}% surface when reported`
            : 'No task content collected'}
        </span>
      </div>
      <figcaption className="sr-only">
        Illustrative Ateva wait surface showing the {copy.label.toLowerCase()}. The integrated
        app&apos;s private task remains outside the surface.
      </figcaption>
    </figure>
  );
}

function VerificationStoryCopy({
  stage,
  className,
  ariaHidden = false,
}: {
  stage: VerificationStage;
  className: string;
  ariaHidden?: boolean;
}) {
  const copy = VERIFICATION_STAGES[stageIndex(stage)].copy;
  const index = stageIndex(stage);

  return (
    <div className={`landing-verification-story__copy-layer ${className}`} aria-hidden={ariaHidden}>
      <span className="landing-verification-story__index">0{index + 1}</span>
      <span className="landing-verification-story__copy">
        <span className="landing-verification-story__label">{copy.label}</span>
        <strong>{copy.title}</strong>
        <span>{copy.detail}</span>
      </span>
      <span aria-hidden="true" className="landing-verification-story__arrow">
        →
      </span>
    </div>
  );
}

function VerificationBoundaryNote({
  stage,
  transitionFromStage,
}: {
  stage: VerificationStage;
  transitionFromStage: VerificationStage | null;
}) {
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);
  const markerPoint =
    VERIFICATION_BOUNDARY_POINTS[stageIndex(stage)] ?? VERIFICATION_BOUNDARY_POINTS[0];
  const motionFromStage = transitionFromStage ?? stage;
  const markerIsMoving = transitionFromStage !== null && !prefersReducedMotion;
  const fromProgress = stageIndex(motionFromStage) / (VERIFICATION_STAGES.length - 1);
  const toProgress = stageIndex(stage) / (VERIFICATION_STAGES.length - 1);

  useEffect(() => {
    const mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    const updatePreference = () => setPrefersReducedMotion(mediaQuery.matches);
    updatePreference();
    mediaQuery.addEventListener?.('change', updatePreference);
    return () => mediaQuery.removeEventListener?.('change', updatePreference);
  }, []);

  const markerMotion = markerIsMoving ? (
    <animateMotion
      key={`${motionFromStage}-${stage}`}
      path={VERIFICATION_BOUNDARY_PATH}
      begin="0s"
      dur={VERIFICATION_BOUNDARY_MOTION_DURATION}
      fill="freeze"
      calcMode="linear"
      keyPoints={`${fromProgress};${toProgress}`}
      keyTimes="0;1"
    />
  ) : null;

  return (
    <aside
      className="landing-verification-boundary"
      aria-label="Ateva measurement boundary"
      data-verification-stage={stage}
    >
      <div className="landing-verification-boundary__sketch" aria-hidden="true">
        <svg viewBox="0 0 460 120" role="presentation">
          <path
            className="landing-verification-boundary__path"
            d={VERIFICATION_BOUNDARY_PATH}
            pathLength={1}
          />
          <path
            className="landing-verification-boundary__path landing-verification-boundary__path--echo"
            d="M12 40C58 17 88 91 141 55S224 24 274 65s91 34 175-13"
            pathLength={1}
          />
          <path className="landing-verification-boundary__arrowhead" d="m427 37 22 6-17 15" />
          <circle
            className="landing-verification-boundary__marker-halo"
            cx={markerIsMoving ? 0 : markerPoint.x}
            cy={markerIsMoving ? 0 : markerPoint.y}
            r="8"
          >
            {markerMotion}
          </circle>
          <circle
            className="landing-verification-boundary__marker"
            cx={markerIsMoving ? 0 : markerPoint.x}
            cy={markerIsMoving ? 0 : markerPoint.y}
            r="4"
          >
            {markerMotion}
          </circle>
        </svg>
      </div>
      <div className="landing-verification-boundary__labels" aria-hidden="true">
        <span>Private work</span>
        <span>Measured wait</span>
        <span>Qualified record</span>
      </div>
      <p>The work remains in the app. Only the eligible wait moves across the boundary.</p>
    </aside>
  );
}

export function LandingProductShowcase() {
  const [activeStage, setActiveStage] = useState<VerificationStage>('eligible');
  const [stageTransition, setStageTransition] = useState<VerificationStageTransition | null>(null);
  const [sequenceInView, setSequenceInView] = useState(false);
  const sequenceRef = useRef<HTMLDivElement>(null);
  const stepRefs = useRef<Array<HTMLElement | null>>([]);
  const hasMounted = useRef(false);
  const previousStageRef = useRef<VerificationStage>('eligible');
  const activeStageRef = useRef<VerificationStage>('eligible');
  const requestedStageRef = useRef<VerificationStage>('eligible');
  const isAdvancingRef = useRef(false);

  const advanceOneStage = useCallback(() => {
    const currentIndex = stageIndex(activeStageRef.current);
    const targetIndex = stageIndex(requestedStageRef.current);
    if (currentIndex === targetIndex || isAdvancingRef.current) return;

    const direction = targetIndex > currentIndex ? 1 : -1;
    const nextStage = VERIFICATION_STAGES[currentIndex + direction].id;
    isAdvancingRef.current = true;
    activeStageRef.current = nextStage;
    setActiveStage(nextStage);
  }, []);

  const requestStage = useCallback(
    (nextStage: VerificationStage) => {
      requestedStageRef.current = nextStage;
      advanceOneStage();
    },
    [advanceOneStage],
  );

  useEffect(() => {
    const element = sequenceRef.current;
    if (!element) return;

    if (!('IntersectionObserver' in window)) {
      setSequenceInView(true);
      return;
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting) return;
        setSequenceInView(true);
        observer.disconnect();
      },
      { rootMargin: '0px 0px -12% 0px', threshold: 0.05 },
    );

    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!hasMounted.current) {
      hasMounted.current = true;
      previousStageRef.current = activeStage;
      activeStageRef.current = activeStage;
      return;
    }

    if (previousStageRef.current === activeStage) return;

    setStageTransition({ from: previousStageRef.current, to: activeStage });
    previousStageRef.current = activeStage;
    const timeout = window.setTimeout(() => {
      setStageTransition(null);
      isAdvancingRef.current = false;
      advanceOneStage();
    }, 440);
    return () => {
      window.clearTimeout(timeout);
    };
  }, [activeStage, advanceOneStage]);

  useEffect(() => {
    const elements = stepRefs.current.filter((element): element is HTMLElement => element !== null);
    if (!elements.length || !('IntersectionObserver' in window)) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const visibleEntry = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
        const nextStage = visibleEntry?.target.getAttribute('data-verification-stage');
        if (nextStage && VERIFICATION_STAGES.some((candidate) => candidate.id === nextStage)) {
          requestStage(nextStage as VerificationStage);
        }
      },
      { rootMargin: '-32% 0px -48% 0px', threshold: [0.1, 0.45, 0.8] },
    );

    elements.forEach((element) => observer.observe(element));
    return () => observer.disconnect();
  }, [requestStage]);

  const transitionFromStage = stageTransition?.to === activeStage ? stageTransition.from : null;
  const isStageUpdating = stageTransition?.to === activeStage;
  const activeCopy = VERIFICATION_STAGES[stageIndex(activeStage)].copy;

  return (
    <div
      ref={sequenceRef}
      id="how-it-works"
      className={`landing-verification-sequence landing-anchor-target${sequenceInView ? ' is-in-view' : ''}`}
    >
      <div className="landing-showcase-heading">
        <div>
          <p className="landing-eyebrow text-brand-300">One delivery, checked in order</p>
          <h2 className="landing-display mt-4 max-w-4xl text-balance text-[clamp(2.8rem,5.7vw,5.4rem)] leading-[0.92] tracking-[-0.05em] text-white">
            Follow the signal from wait to record.
          </h2>
        </div>
        <p className="max-w-md text-[15px] leading-7 text-white/62">
          The same product surface moves through eligibility, placement, visibility, verification,
          and qualified delivery.
        </p>
      </div>

      <div className="landing-verification-sequence__grid">
        <div className="landing-verification-canvas">
          <div className="landing-verification-canvas__label">
            <span>Product sequence</span>
            <span>{stageIndex(activeStage) + 1} / 5</span>
          </div>
          <div className="landing-verification-progress" aria-hidden="true">
            <span
              style={{
                width: `${((stageIndex(activeStage) + 1) / VERIFICATION_STAGES.length) * 100}%`,
              }}
            />
          </div>
          <VerificationArtifact stage={activeStage} isUpdating={isStageUpdating} />
          <p className="landing-verification-canvas__caption">
            Illustrative product state. No source code, prompts, completions, or terminal output are
            used.
          </p>
        </div>

        <div className="landing-verification-story">
          <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">
            {activeCopy.label}: {activeCopy.title}
          </p>
          <div
            className={`landing-verification-story__panel${isStageUpdating ? ' is-updating' : ''}`}
            aria-label="Current verification stage"
          >
            <div className="landing-verification-story__panel-frame">
              {transitionFromStage ? (
                <VerificationStoryCopy
                  stage={transitionFromStage}
                  className="landing-verification-story__copy-layer--previous"
                  ariaHidden
                />
              ) : null}
              <VerificationStoryCopy
                stage={activeStage}
                className="landing-verification-story__copy-layer--current"
              />
            </div>
          </div>

          <VerificationBoundaryNote stage={activeStage} transitionFromStage={transitionFromStage} />

          <ol>
            {VERIFICATION_STAGES.map(({ id, copy }, index) => {
              const isActive = id === activeStage;
              return (
                <li
                  key={id}
                  ref={(element) => {
                    stepRefs.current[index] = element;
                  }}
                  data-verification-stage={id}
                  className={isActive ? 'is-active' : ''}
                >
                  <button
                    type="button"
                    aria-current={isActive ? 'step' : undefined}
                    aria-label={`Show ${copy.label}: ${copy.title}`}
                    className="landing-verification-story__trigger"
                    onClick={() => requestStage(id)}
                  >
                    <span className="sr-only">
                      Stage {index + 1}: {copy.label}. {copy.title} {copy.detail}
                    </span>
                  </button>
                </li>
              );
            })}
          </ol>
        </div>
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
