'use client';

import { useId, useState } from 'react';

function trimNumber(value: number, decimals: number): string {
  return decimals > 0 ? String(Number(value.toFixed(decimals))) : String(Math.round(value));
}

/**
 * A typed numeric field that accepts what the visitor means.
 *
 * The hard part of a typed number is the half-finished one. Clamping on every
 * keystroke makes a field impossible to edit — clearing "45" to type "120"
 * would snap to the minimum the instant it went empty, and backspacing through
 * "4.5" would fight the decimal point. So the raw text is held while the field
 * is being edited, the result updates live for any value that is already valid,
 * and the number is clamped only on blur, with the correction stated rather
 * than performed silently.
 */
export function NumberField({
  label,
  value,
  min,
  max,
  step = 1,
  decimals = 0,
  prefix,
  suffix,
  hint,
  onCommit,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  decimals?: number;
  prefix?: string;
  suffix?: string;
  hint: string;
  onCommit: (next: number) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const id = useId();
  const hintId = `${id}-hint`;

  const shown = draft ?? trimNumber(value, decimals);
  const parsed = draft === null ? value : Number(draft);
  const outOfRange =
    draft !== null &&
    draft.trim() !== '' &&
    Number.isFinite(parsed) &&
    (parsed < min || parsed > max);

  const commit = () => {
    if (draft === null) return;
    const next = Number(draft);
    setDraft(null);
    if (draft.trim() === '' || !Number.isFinite(next)) return;
    onCommit(Math.min(max, Math.max(min, next)));
  };

  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={id} className="text-sm font-medium text-[var(--ink)]">
        {label}
      </label>
      <div
        className={`flex items-center rounded-xl border bg-[var(--glass-strong)] transition-colors focus-within:border-[var(--ink)] focus-within:ring-2 focus-within:ring-[var(--hair)] ${
          outOfRange ? 'border-[var(--ink)]' : 'border-[var(--hair)]'
        }`}
      >
        {prefix && (
          <span aria-hidden="true" className="dash-mono pl-3.5 text-sm text-[var(--muted)]">
            {prefix}
          </span>
        )}
        <input
          id={id}
          type="number"
          inputMode="decimal"
          value={shown}
          min={min}
          max={max}
          step={step}
          aria-label={label}
          aria-describedby={hintId}
          aria-invalid={outOfRange || undefined}
          onChange={(e) => {
            const text = e.target.value;
            setDraft(text);
            const next = Number(text);
            // Update the result as it is typed, but only from a value that is
            // already usable — a half-typed or out-of-range number should not
            // move the figures next to it.
            if (text.trim() !== '' && Number.isFinite(next) && next >= min && next <= max) {
              onCommit(next);
            }
          }}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur();
          }}
          // A scroll wheel over a focused number input silently changes it,
          // which is a real hazard on a page the visitor is scrolling through.
          onWheel={(e) => e.currentTarget.blur()}
          className={`dash-mono h-11 w-full rounded-none! border-0! bg-transparent! px-3.5 text-[17px] font-medium text-[var(--ink)] outline-none! ${
            prefix ? 'pl-1.5' : ''
          }`}
        />
        {suffix && (
          <span aria-hidden="true" className="dash-mono pr-3.5 text-sm text-[var(--muted)]">
            {suffix}
          </span>
        )}
      </div>
      <span
        id={hintId}
        className={`dash-mono text-xs ${outOfRange ? 'font-semibold text-[var(--ink)]' : 'text-[var(--muted)]'}`}
      >
        {outOfRange
          ? `Enter ${trimNumber(min, decimals)} – ${trimNumber(max, decimals)}; anything outside is set back to the nearest end.`
          : hint}
      </span>
    </div>
  );
}
