'use client';

import { useState } from 'react';

import { AD_SERVING, MINIMUM_VISIBLE_DURATION_MS } from '@ateva/shared';

import { NumberField } from './ui/number-field';

type Mode = 'developer' | 'advertiser';

/**
 * Homepage planner for what participating in the beta looks like.
 *
 * Replaces `EarningsCalculator`, which was named for a calculation it is
 * forbidden to perform. Its developer mode had three sliders whose output was a
 * fixed sentence — moving any of them changed nothing — and one of those
 * sliders was "Average Campaign CPM", which invited a visitor to read their own
 * outcome off an advertiser's spend. Participation is compensated at 60% of the
 * qualifying bid, but that 60% is an Ateva obligation settled separately — not
 * a claim on the advertiser's payment — and a CPM slider blurred exactly that
 * distinction. This planner reports signals and screen time instead.
 *
 * Both modes now take typed values rather than dragged ones. A slider is a poor
 * fit here: these are quantities a visitor already knows ("about a $2,000
 * campaign", "roughly 45 waits"), and a slider makes stating a known number
 * harder than it should be — it cannot be typed or pasted, it is imprecise at
 * the low end of a wide range, and its value is invisible until grabbed. Typed
 * fields let someone enter what they know and read the result; the presets stay
 * for visitors who would rather recognise a day than count one.
 *
 * Ranges are the platform's own limits, imported rather than restated, so the
 * form cannot drift from what the API enforces.
 *
 * Accessible names here are consumed by `apps/web/e2e/a11y.spec.ts`
 * ("homepage planner controls have accessible names in both modes"); changing
 * them means changing that test.
 */

/** Seconds a unit must stay visible before the wait can qualify. */
const VISIBLE_FLOOR_SECONDS = MINIMUM_VISIBLE_DURATION_MS / 1000;
/** Hours left once quiet hours (22:00–08:00) are silenced. */
const ACTIVE_HOURS_WITH_QUIET = 14;
const HOURS_PER_DAY = 24;
const WAITS_MIN = 1;
const WAITS_MAX = 500;

/** Advertiser-side limits, in whole dollars, from the platform's minor units. */
const BUDGET_MIN = AD_SERVING.MIN_CAMPAIGN_BUDGET_MINOR / 100;
const BUDGET_MAX = AD_SERVING.MAX_CAMPAIGN_BUDGET_MINOR / 100;
const CPM_MIN = 1;
const CPM_MAX = 20;
const CTR_MIN = 0.1;
const CTR_MAX = 10;

/**
 * Anchors for the three presets.
 *
 * ESTIMATES, not measurements — they exist so a visitor can recognise a day
 * rather than recall a number they have never counted. Replace them with real
 * percentiles once beta telemetry can support them.
 */
const PRESETS = [
  { id: 'occasional', name: 'Occasional', blurb: 'A few builds and test runs', waits: 15 },
  { id: 'typical', name: 'Typical', blurb: 'Steady agent use through the day', waits: 45 },
  { id: 'heavy', name: 'Heavy', blurb: 'An agent running most of the day', waits: 120 },
] as const;

const DEV_DEFAULTS = {
  waits: 45,
  rate: AD_SERVING.MAX_ADS_PER_HOUR_DEFAULT,
  quiet: true,
} as const;
const ADV_DEFAULTS = { budget: 2000, cpm: 4, ctr: 2 } as const;

function formatDuration(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  if (minutes > 0) return `${minutes} min`;
  return `${totalSeconds} s`;
}

function ResultPair({ caption, value, unit }: { caption: string; value: string; unit: string }) {
  return (
    <div className="landing-planner-result flex flex-col gap-1">
      <span className="font-mono text-[11px] uppercase tracking-[0.1em] text-surface-500">
        {caption}
      </span>
      <span className="font-serif text-[46px] leading-none text-surface-950">{value}</span>
      <span className="font-mono text-xs text-surface-500">{unit}</span>
    </div>
  );
}

export function BetaSignalPlanner() {
  const [mode, setMode] = useState<Mode>('developer');

  const [waits, setWaits] = useState<number>(DEV_DEFAULTS.waits);
  const [rate, setRate] = useState<number>(DEV_DEFAULTS.rate);
  const [quiet, setQuiet] = useState<boolean>(DEV_DEFAULTS.quiet);
  const [preset, setPreset] = useState<string>('typical');

  const [budget, setBudget] = useState<number>(ADV_DEFAULTS.budget);
  const [cpm, setCpm] = useState<number>(ADV_DEFAULTS.cpm);
  const [ctr, setCtr] = useState<number>(ADV_DEFAULTS.ctr);

  const activeHours = quiet ? ACTIVE_HOURS_WITH_QUIET : HOURS_PER_DAY;
  const ceiling = rate * activeHours;
  const signals = Math.min(waits, ceiling);
  const capBinds = ceiling < waits;
  const screenTime = formatDuration(signals * VISIBLE_FLOOR_SECONDS);
  const devDirty =
    waits !== DEV_DEFAULTS.waits || rate !== DEV_DEFAULTS.rate || quiet !== DEV_DEFAULTS.quiet;

  const impressions = Math.round((budget / cpm) * 1000);
  const clicks = Math.round((impressions * ctr) / 100);
  const costPerClick = clicks > 0 ? budget / clicks : null;
  const advDirty =
    budget !== ADV_DEFAULTS.budget || cpm !== ADV_DEFAULTS.cpm || ctr !== ADV_DEFAULTS.ctr;

  const resetDev = () => {
    setWaits(DEV_DEFAULTS.waits);
    setRate(DEV_DEFAULTS.rate);
    setQuiet(DEV_DEFAULTS.quiet);
    setPreset('typical');
  };

  const resetAdv = () => {
    setBudget(ADV_DEFAULTS.budget);
    setCpm(ADV_DEFAULTS.cpm);
    setCtr(ADV_DEFAULTS.ctr);
  };

  const resetButton = (dirty: boolean, onReset: () => void) => (
    <button
      type="button"
      onClick={onReset}
      disabled={!dirty}
      className={`landing-planner-reset rounded-full px-3.5 py-1.5 text-[13px] ${
        dirty
          ? 'bg-brand-100 text-brand-700 hover:bg-brand-200'
          : 'cursor-not-allowed text-surface-300'
      }`}
    >
      Reset
    </button>
  );

  return (
    <section
      aria-label="Beta planning calculator"
      className="landing-card landing-planner mx-auto mt-14 max-w-[1180px] rounded-3xl border border-surface-200/70 bg-white px-8 py-7"
    >
      <div className="mb-1 flex flex-wrap items-start justify-between gap-5">
        <h3 className="landing-planner-title m-0 font-serif font-normal text-surface-950">
          {mode === 'developer'
            ? 'What this looks like on your machine'
            : 'Plan beta campaign reach'}
        </h3>
        <button
          type="button"
          onClick={() => setMode((m) => (m === 'developer' ? 'advertiser' : 'developer'))}
          className="landing-planner-mode-toggle inline-flex min-h-11 items-center rounded-full border border-surface-950 bg-transparent px-5 text-sm text-surface-950 hover:bg-surface-100/60"
        >
          {mode === 'developer' ? 'For advertisers' : 'For developers'}
        </button>
      </div>

      {mode === 'developer' ? (
        <>
          <p className="mb-6 mt-0 max-w-[640px] text-[14.5px] leading-relaxed text-surface-600">
            Pick the day that sounds like yours, or type your own numbers. Nothing here projects
            money — none moves during the beta.
          </p>

          {/* Recognition before recall: a day you can identify, not a number you must know. */}
          <div className="mb-6 flex flex-col gap-2.5">
            <span className="font-mono text-[11px] uppercase tracking-[0.1em] text-surface-500">
              A day like…
            </span>
            <div
              role="radiogroup"
              aria-label="Typical day"
              className="grid grid-cols-1 gap-3 sm:grid-cols-3"
            >
              {PRESETS.map((p) => {
                const active = preset === p.id;
                return (
                  <button
                    key={p.id}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    onClick={() => {
                      setWaits(p.waits);
                      setPreset(p.id);
                    }}
                    className={`landing-planner-choice flex min-h-11 flex-col gap-1.5 rounded-2xl p-4 text-left transition-colors ${
                      active
                        ? 'border border-brand-500 bg-brand-50'
                        : 'border border-surface-200/70 bg-white hover:bg-surface-50'
                    }`}
                  >
                    <span
                      className={`text-[15px] font-semibold ${active ? 'text-brand-700' : 'text-surface-950'}`}
                    >
                      {p.name}
                    </span>
                    <span className="text-[12.5px] leading-snug text-surface-600">{p.blurb}</span>
                    <span
                      className={`font-mono text-xs ${active ? 'text-brand-700' : 'text-surface-500'}`}
                    >
                      ≈ {p.waits} waits a day
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="grid grid-cols-1 gap-8 md:grid-cols-[0.9fr_1.1fr]">
            <div className="flex flex-col gap-[18px]">
              <div className="flex items-center justify-between gap-3">
                <span className="font-mono text-[11px] uppercase tracking-[0.1em] text-surface-500">
                  Or set it exactly
                </span>
                {resetButton(devDirty, resetDev)}
              </div>

              <NumberField
                label="Eligible waits per day"
                value={waits}
                min={WAITS_MIN}
                max={WAITS_MAX}
                onCommit={(next) => {
                  setWaits(next);
                  setPreset('');
                }}
                hint={`Agent pauses lasting at least ${VISIBLE_FLOOR_SECONDS.toFixed(2)} s · ${WAITS_MIN} – ${WAITS_MAX}`}
              />

              <NumberField
                label="Units per hour you allow"
                value={rate}
                min={AD_SERVING.MAX_ADS_PER_HOUR_MIN}
                max={AD_SERVING.MAX_ADS_PER_HOUR_MAX}
                onCommit={setRate}
                hint={
                  rate >= AD_SERVING.MAX_ADS_PER_HOUR_MAX
                    ? 'At the maximum the platform allows'
                    : rate <= AD_SERVING.MAX_ADS_PER_HOUR_MIN
                      ? 'At the minimum — turn units off entirely in settings'
                      : `Allowed range ${AD_SERVING.MAX_ADS_PER_HOUR_MIN} – ${AD_SERVING.MAX_ADS_PER_HOUR_MAX} · default ${AD_SERVING.MAX_ADS_PER_HOUR_DEFAULT}`
                }
              />

              <button
                type="button"
                role="switch"
                aria-checked={quiet}
                aria-label="Quiet hours"
                onClick={() => setQuiet((q) => !q)}
                className={`landing-planner-switch flex min-h-11 items-center justify-between gap-4 rounded-xl p-4 text-left transition-colors ${
                  quiet
                    ? 'border border-brand-200 bg-brand-50'
                    : 'border border-surface-200 bg-surface-50'
                }`}
              >
                <span className="flex flex-col gap-0.5">
                  <span className="text-sm font-medium text-surface-950">Quiet hours</span>
                  <span className="text-[12.5px] text-surface-600">Silences 22:00 – 08:00</span>
                </span>
                <span className="flex items-center gap-2.5">
                  <span
                    className={`font-mono text-[11px] font-semibold tracking-[0.1em] ${quiet ? 'text-brand-700' : 'text-surface-500'}`}
                  >
                    {quiet ? 'ON' : 'OFF'}
                  </span>
                  <span
                    className={`flex h-[26px] w-[46px] items-center rounded-full px-[3px] ${
                      quiet ? 'justify-end bg-brand-500' : 'justify-start bg-surface-300'
                    }`}
                  >
                    <span className="h-5 w-5 rounded-full bg-white" />
                  </span>
                </span>
              </button>
            </div>

            <div className="flex flex-col gap-4 md:border-l md:border-surface-200 md:pl-8">
              <div aria-live="polite" className="grid grid-cols-2 gap-5">
                <ResultPair
                  caption="Verified output"
                  value={signals.toLocaleString()}
                  unit="verified signals a day"
                />
                <ResultPair
                  caption="Visibility floor"
                  value={screenTime}
                  unit="of screen time a day"
                />
              </div>

              {/* Name the binding limit rather than leaving the visitor to infer it. */}
              <p
                className={`landing-planner-message m-0 rounded-[10px] border p-3.5 text-sm leading-relaxed ${
                  capBinds
                    ? 'border-amber-200 bg-amber-50 text-amber-800'
                    : 'border-brand-200 bg-brand-50 text-brand-700'
                }`}
              >
                {capBinds
                  ? `Your own limit is what caps this, not your usage: ${rate} an hour across ${activeHours} active hours stops the day at ${ceiling}. ${waits - ceiling} eligible waits would pass unused.`
                  : `Every eligible wait fits — your ${ceiling}-a-day ceiling is above your usage, so nothing is turned away.`}
              </p>

              <p className="m-0 border-t border-surface-200 pt-3.5 text-[13.5px] leading-relaxed text-surface-600">
                Signals are the beta&rsquo;s output, not a balance — nothing accrues. Source code,
                prompts and terminal output are never read, at any volume.
              </p>
            </div>
          </div>
        </>
      ) : (
        <>
          <p className="mb-6 mt-0 max-w-[640px] text-[14.5px] leading-relaxed text-surface-600">
            Type the campaign you have in mind. Delivery is modelled from your own budget and rate —
            beta campaigns are not billed.
          </p>

          <div className="grid grid-cols-1 gap-8 md:grid-cols-[0.9fr_1.1fr]">
            <div className="flex flex-col gap-[18px]">
              <div className="flex items-center justify-between gap-3">
                <span className="font-mono text-[11px] uppercase tracking-[0.1em] text-surface-500">
                  Your campaign
                </span>
                {resetButton(advDirty, resetAdv)}
              </div>

              <NumberField
                label="Campaign budget"
                value={budget}
                min={BUDGET_MIN}
                max={BUDGET_MAX}
                step={50}
                prefix="$"
                onCommit={setBudget}
                hint={`Platform range $${BUDGET_MIN.toLocaleString()} – $${BUDGET_MAX.toLocaleString()}`}
              />

              <NumberField
                label="Target CPM"
                value={cpm}
                min={CPM_MIN}
                max={CPM_MAX}
                step={0.5}
                decimals={2}
                prefix="$"
                onCommit={setCpm}
                hint={`What you pay per 1,000 qualified impressions · $${CPM_MIN} – $${CPM_MAX}`}
              />

              <NumberField
                label="Expected click-through rate"
                value={ctr}
                min={CTR_MIN}
                max={CTR_MAX}
                step={0.1}
                decimals={1}
                suffix="%"
                onCommit={setCtr}
                hint={`Your own assumption, not a platform figure · ${CTR_MIN}% – ${CTR_MAX}%`}
              />
            </div>

            <div className="flex flex-col gap-4 md:border-l md:border-surface-200 md:pl-8">
              <div aria-live="polite" className="grid grid-cols-2 gap-5">
                <ResultPair
                  caption="You’d reach"
                  value={impressions.toLocaleString()}
                  unit="qualified impressions"
                />
                <ResultPair
                  caption="At your assumed rate"
                  value={clicks.toLocaleString()}
                  unit="clicks"
                />
              </div>

              <p className="landing-planner-message m-0 rounded-[10px] border border-surface-200 bg-surface-50 p-3.5 text-sm leading-relaxed text-surface-700">
                {costPerClick === null
                  ? 'At this click-through rate the campaign models fewer than one click — raise the budget or the rate to see a cost per click.'
                  : `That works out to $${costPerClick.toFixed(2)} per click. Impressions are counted only after the verification checks pass, so this is delivery you can audit rather than reported views.`}
              </p>

              <p className="m-0 border-t border-surface-200 pt-3.5 text-[13.5px] leading-relaxed text-surface-600">
                Click-through is your own assumption — Ateva does not publish a benchmark it has not
                measured. Nothing here is a quote, and no campaign is billed during the beta.
              </p>
            </div>
          </div>
        </>
      )}
    </section>
  );
}
