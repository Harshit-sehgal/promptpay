'use client';

import { useState } from 'react';

import { AD_SERVING, MINIMUM_VISIBLE_DURATION_MS } from '@ateva/shared';

type Mode = 'developer' | 'advertiser';

/**
 * Homepage planner for what participating in the beta looks like.
 *
 * Replaces `EarningsCalculator`, which was named for a calculation it is
 * forbidden to perform. Its developer mode had three sliders whose output was a
 * fixed sentence — moving any of them changed nothing — and one of those
 * sliders was "Average Campaign CPM", which implied a participant's outcome
 * tracks an advertiser's spend directly beneath the Beta guarantee that says
 * "No participant owns a percentage of an advertiser transaction".
 *
 * Developer mode now answers both halves of the exchange — signals contributed
 * and screen time given up — from limits the platform actually enforces, and
 * names which limit is binding. Advertiser mode keeps its sliders: that side
 * already computed real numbers from real inputs.
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
const WAITS_STEP = 5;

/**
 * Anchors for the three presets.
 *
 * ESTIMATES, not measurements — they exist so a visitor can recognise a day
 * rather than recall a number they have never counted. Replace them with real
 * percentiles once beta telemetry can support them.
 */
const PRESETS = [
  {
    id: 'occasional',
    name: 'Occasional',
    blurb: 'A few builds and test runs',
    waits: 15,
  },
  {
    id: 'typical',
    name: 'Typical',
    blurb: 'Steady agent use through the day',
    waits: 45,
  },
  {
    id: 'heavy',
    name: 'Heavy',
    blurb: 'An agent running most of the day',
    waits: 120,
  },
] as const;

const DEFAULTS = { waits: 45, rate: AD_SERVING.MAX_ADS_PER_HOUR_DEFAULT, quiet: true } as const;

function formatDuration(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  if (minutes > 0) return `${minutes} min`;
  return `${totalSeconds} s`;
}

function Stepper({
  label,
  value,
  min,
  max,
  step = 1,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (next: number) => void;
}) {
  const atMin = value <= min;
  const atMax = value >= max;
  const button =
    'inline-flex h-11 w-12 items-center justify-center text-xl font-medium transition-colors disabled:cursor-not-allowed';

  return (
    <div className="inline-flex items-center rounded-[10px] border border-surface-300 bg-white">
      <button
        type="button"
        aria-label={`Decrease ${label.toLowerCase()}`}
        disabled={atMin}
        onClick={() => onChange(Math.max(min, value - step))}
        className={`${button} rounded-l-[10px] ${atMin ? 'bg-surface-50 text-surface-300' : 'text-surface-950 hover:bg-surface-50'}`}
      >
        −
      </button>
      <output
        aria-label={label}
        className="inline-flex h-11 min-w-[84px] items-center justify-center border-x border-surface-200 font-mono text-[17px] font-medium text-surface-950"
      >
        {value}
      </output>
      <button
        type="button"
        aria-label={`Increase ${label.toLowerCase()}`}
        disabled={atMax}
        onClick={() => onChange(Math.min(max, value + step))}
        className={`${button} rounded-r-[10px] ${atMax ? 'bg-surface-50 text-surface-300' : 'text-surface-950 hover:bg-surface-50'}`}
      >
        +
      </button>
    </div>
  );
}

export function BetaSignalPlanner() {
  const [mode, setMode] = useState<Mode>('developer');

  const [waits, setWaits] = useState<number>(DEFAULTS.waits);
  const [rate, setRate] = useState<number>(DEFAULTS.rate);
  const [quiet, setQuiet] = useState<boolean>(DEFAULTS.quiet);
  const [preset, setPreset] = useState<string>('typical');

  const [campaignBudget, setCampaignBudget] = useState(2000);
  const [targetCpm, setTargetCpm] = useState(4);
  const [ctr, setCtr] = useState(2);

  const activeHours = quiet ? ACTIVE_HOURS_WITH_QUIET : HOURS_PER_DAY;
  const ceiling = rate * activeHours;
  const signals = Math.min(waits, ceiling);
  const capBinds = ceiling < waits;
  const screenTime = formatDuration(signals * VISIBLE_FLOOR_SECONDS);
  const isDirty = waits !== DEFAULTS.waits || rate !== DEFAULTS.rate || quiet !== DEFAULTS.quiet;

  const advertiserImpressions = Math.round((campaignBudget / targetCpm) * 1000);
  const advertiserClicks = Math.round((advertiserImpressions * ctr) / 100);

  const reset = () => {
    setWaits(DEFAULTS.waits);
    setRate(DEFAULTS.rate);
    setQuiet(DEFAULTS.quiet);
    setPreset('typical');
  };

  return (
    <section
      aria-label="Beta planning calculator"
      className="mx-auto mt-14 max-w-[1180px] rounded-2xl border border-surface-200 bg-white px-8 py-7"
    >
      <div className="mb-1 flex flex-wrap items-start justify-between gap-5">
        <h3 className="m-0 font-serif text-[27px] font-normal text-surface-950">
          {mode === 'developer'
            ? 'What this looks like on your machine'
            : 'Plan beta campaign reach'}
        </h3>
        <button
          type="button"
          onClick={() => setMode((m) => (m === 'developer' ? 'advertiser' : 'developer'))}
          className="inline-flex min-h-11 items-center rounded-[10px] border border-surface-300 bg-surface-50 px-4 text-sm text-surface-950 hover:bg-surface-100"
        >
          {mode === 'developer' ? 'For advertisers' : 'For developers'}
        </button>
      </div>

      {mode === 'developer' ? (
        <>
          <p className="mb-6 mt-0 max-w-[640px] text-[14.5px] leading-relaxed text-surface-600">
            Pick the day that sounds like yours. Nothing here projects money — none moves during the
            beta.
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
                    className={`flex min-h-11 flex-col gap-1.5 rounded-xl p-4 text-left transition-colors ${
                      active
                        ? 'border-2 border-brand-500 bg-brand-50'
                        : 'border border-surface-200 bg-white hover:bg-surface-50'
                    }`}
                  >
                    <span
                      className={`text-[15px] font-semibold ${active ? 'text-brand-700' : 'text-surface-950'}`}
                    >
                      {p.name}
                    </span>
                    <span className="text-[12.5px] leading-snug text-surface-600">{p.blurb}</span>
                    <span className="font-mono text-xs text-surface-500">
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
                <button
                  type="button"
                  onClick={reset}
                  disabled={!isDirty}
                  className={`rounded-lg px-2.5 py-1.5 text-[13px] ${
                    isDirty
                      ? 'bg-brand-50 text-brand-700 hover:bg-brand-100'
                      : 'cursor-not-allowed text-surface-300'
                  }`}
                >
                  Reset
                </button>
              </div>

              <div className="flex flex-col gap-2">
                <span className="text-sm font-medium text-surface-950">Eligible waits per day</span>
                <Stepper
                  label="Eligible waits per day"
                  value={waits}
                  min={WAITS_MIN}
                  max={WAITS_MAX}
                  step={WAITS_STEP}
                  onChange={(next) => {
                    setWaits(next);
                    setPreset('');
                  }}
                />
                <span className="font-mono text-xs text-surface-500">
                  Agent pauses lasting at least {VISIBLE_FLOOR_SECONDS.toFixed(2)} s
                </span>
              </div>

              <div className="flex flex-col gap-2">
                <span className="text-sm font-medium text-surface-950">
                  Units per hour you allow
                </span>
                <Stepper
                  label="Units per hour you allow"
                  value={rate}
                  min={AD_SERVING.MAX_ADS_PER_HOUR_MIN}
                  max={AD_SERVING.MAX_ADS_PER_HOUR_MAX}
                  onChange={setRate}
                />
                <span
                  className={`font-mono text-xs ${
                    rate >= AD_SERVING.MAX_ADS_PER_HOUR_MAX ||
                    rate <= AD_SERVING.MAX_ADS_PER_HOUR_MIN
                      ? 'text-amber-700'
                      : 'text-surface-500'
                  }`}
                >
                  {rate >= AD_SERVING.MAX_ADS_PER_HOUR_MAX
                    ? 'At the maximum the platform allows'
                    : rate <= AD_SERVING.MAX_ADS_PER_HOUR_MIN
                      ? 'At the minimum — turn units off entirely in settings'
                      : `Allowed range ${AD_SERVING.MAX_ADS_PER_HOUR_MIN} – ${AD_SERVING.MAX_ADS_PER_HOUR_MAX} · default ${AD_SERVING.MAX_ADS_PER_HOUR_DEFAULT}`}
                </span>
              </div>

              <button
                type="button"
                role="switch"
                aria-checked={quiet}
                aria-label="Quiet hours"
                onClick={() => setQuiet((q) => !q)}
                className={`flex min-h-11 items-center justify-between gap-4 rounded-xl p-4 text-left transition-colors ${
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
                <div className="flex flex-col gap-1">
                  <span className="font-mono text-[11px] uppercase tracking-[0.1em] text-surface-500">
                    You&rsquo;d contribute
                  </span>
                  <span className="font-serif text-[46px] leading-none text-surface-950">
                    {signals.toLocaleString()}
                  </span>
                  <span className="font-mono text-xs text-surface-500">verified signals a day</span>
                </div>
                <div className="flex flex-col gap-1">
                  <span className="font-mono text-[11px] uppercase tracking-[0.1em] text-surface-500">
                    It would cost you
                  </span>
                  <span className="font-serif text-[46px] leading-none text-surface-950">
                    {screenTime}
                  </span>
                  <span className="font-mono text-xs text-surface-500">of screen time a day</span>
                </div>
              </div>

              {/* Name the binding limit rather than leaving the visitor to infer it. */}
              <p
                className={`m-0 rounded-[10px] border p-3.5 text-sm leading-relaxed ${
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
        <div className="mt-5 grid gap-4">
          <label className="block text-sm text-surface-600">
            Campaign Budget: ${campaignBudget}
            <input
              type="range"
              aria-label="Campaign Budget"
              min={100}
              max={100000}
              step={100}
              value={campaignBudget}
              onChange={(e) => setCampaignBudget(Number(e.target.value))}
              className="w-full accent-brand-500"
            />
          </label>
          <label className="block text-sm text-surface-600">
            Target CPM: ${targetCpm}
            <input
              type="range"
              aria-label="Target CPM"
              min={1}
              max={20}
              value={targetCpm}
              onChange={(e) => setTargetCpm(Number(e.target.value))}
              className="w-full accent-brand-500"
            />
          </label>
          <label className="block text-sm text-surface-600">
            Expected Click-Through Rate (CTR): {ctr}%
            <input
              type="range"
              aria-label="Expected Click-Through Rate (CTR)"
              min={0.1}
              max={10}
              step={0.1}
              value={ctr}
              onChange={(e) => setCtr(Number(e.target.value))}
              className="w-full accent-brand-500"
            />
          </label>
          <p aria-live="polite" className="m-0 mt-1 text-[15px] text-surface-950">
            Estimated impressions: <strong>{advertiserImpressions.toLocaleString()}</strong> ·
            clicks: <strong>{advertiserClicks.toLocaleString()}</strong>
          </p>
        </div>
      )}
    </section>
  );
}
