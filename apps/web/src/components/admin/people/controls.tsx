'use client';

import { useEffect, useRef, useState } from 'react';
import type { Tone } from '@/components/dash';

/** A text filter that reports its value after the operator pauses typing. */
export function DebouncedInput({
  label,
  value,
  onCommit,
  placeholder,
  maxLength,
  transform,
  accept,
  className = '',
}: {
  label: string;
  value: string;
  onCommit: (next: string) => void;
  placeholder?: string;
  maxLength?: number;
  transform?: (raw: string) => string;
  /** Only commit values this accepts, so half-typed input does not refetch. */
  accept?: (next: string) => boolean;
  className?: string;
}) {
  const [text, setText] = useState(value);
  // Follow outside resets (tab switch, back to the bare URL) without
  // clobbering what the user is typing between commits.
  const lastValue = useRef(value);
  useEffect(() => {
    if (value !== lastValue.current) {
      lastValue.current = value;
      setText(value);
    }
  }, [value]);
  const commit = useRef(onCommit);
  useEffect(() => {
    commit.current = onCommit;
  });

  useEffect(() => {
    if (text === value) return;
    if (accept && !accept(text)) return;
    const timer = setTimeout(() => commit.current(text), 300);
    return () => clearTimeout(timer);
  }, [text, value, accept]);

  return (
    <label className={`block ${className}`.trim()}>
      <span className="mb-1.5 block text-xs font-medium text-[var(--muted)]">{label}</span>
      <input
        type="text"
        value={text}
        maxLength={maxLength}
        placeholder={placeholder}
        autoComplete="off"
        onChange={(event) =>
          setText(transform ? transform(event.target.value) : event.target.value)
        }
        className="w-full px-3 py-2 text-sm"
      />
    </label>
  );
}

export function SelectFilter({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (next: string) => void;
  options: Array<{ value: string; label: string }>;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-medium text-[var(--muted)]">{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="px-3 py-2 text-sm"
      >
        {options.map((option) => (
          <option key={option.value || 'all'} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

export function Pager({
  page,
  limit,
  total,
  busy,
  onPage,
}: {
  page: number;
  limit: number;
  total: number;
  busy: boolean;
  onPage: (next: number) => void;
}) {
  const totalPages = Math.max(1, Math.ceil(total / limit));
  const first = total === 0 ? 0 : (page - 1) * limit + 1;
  const last = Math.min(total, page * limit);
  return (
    <div className="dash-bar flex flex-wrap items-center justify-between gap-3 text-sm">
      <span className="text-[var(--muted)]" aria-live="polite">
        {total === 0
          ? 'No rows'
          : `${first.toLocaleString()} to ${last.toLocaleString()} of ${total.toLocaleString()} (page ${page} of ${totalPages})`}
      </span>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => onPage(Math.max(1, Math.min(totalPages, page - 1)))}
          disabled={page <= 1 || busy}
          className="dash-btn dash-btn--secondary dash-btn--sm"
        >
          Previous
        </button>
        <button
          type="button"
          onClick={() => onPage(Math.min(totalPages, page + 1))}
          disabled={page >= totalPages || busy}
          className="dash-btn dash-btn--secondary dash-btn--sm"
        >
          Next
        </button>
      </div>
    </div>
  );
}

export function formatDay(iso: string | null | undefined): string {
  if (!iso) return '-';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '-';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** Hands a CSV string to the browser as a file download. */
export function downloadCsv(filename: string, csv: string): void {
  // The BOM makes Excel read the file as UTF-8.
  const blob = new Blob(['﻿', csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Revoking in the same task can cancel the download in Safari and Firefox.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

export function userStatusTone(status: string): Tone {
  if (status === 'banned') return 'bad';
  if (status === 'restricted') return 'warn';
  if (status === 'active') return 'ok';
  return 'neutral';
}
