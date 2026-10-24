import type { ReactNode } from 'react';

import { ActionLink } from './action-link';
import { Notice } from './notice';
import { Panel } from './panel';

/** Segment error boundary body: a bad-tone notice with one retry control. */
export function RouteError({
  title,
  children,
  actionLabel,
  onRetry,
}: {
  title: string;
  children: ReactNode;
  actionLabel: string;
  onRetry: () => void;
}) {
  return (
    <Notice
      tone="bad"
      role="alert"
      title={title}
      actions={
        <button type="button" onClick={onRetry} className="dash-btn dash-btn--primary dash-btn--sm">
          {actionLabel}
        </button>
      }
    >
      {children}
    </Notice>
  );
}

/** Segment 404 body, rendered inside the dashboard shell. */
export function RouteNotFound({
  children,
  href,
  actionLabel,
}: {
  children: ReactNode;
  href: string;
  actionLabel: string;
}) {
  return (
    <Panel label="Page not found">
      <div className="py-10 text-center">
        <p className="dash-mono text-5xl text-[var(--muted)]">404</p>
        <h1 className="dash-title mt-3">Page not found</h1>
        <p className="mx-auto mt-2 max-w-sm text-sm text-[var(--copy)]">{children}</p>
        <div className="mt-6 flex justify-center">
          <ActionLink href={href} variant="primary">
            {actionLabel}
          </ActionLink>
        </div>
      </div>
    </Panel>
  );
}

function Bar({ className }: { className: string }) {
  return (
    <div
      className={`animate-pulse rounded-full bg-[var(--hair)] motion-reduce:animate-none ${className}`}
    />
  );
}

/** Segment loading placeholder: a header and a few glass panels of pulse bars. */
export function RouteSkeleton({ panels = 3, columns = 1 }: { panels?: number; columns?: 1 | 3 }) {
  return (
    <div aria-busy="true" aria-label="Loading" className="grid gap-5">
      <div className="grid gap-3">
        <Bar className="h-3 w-24" />
        <Bar className="h-9 w-64" />
        <Bar className="h-4 w-80 max-w-full" />
      </div>
      <div className={columns === 3 ? 'dash-grid dash-grid--3' : 'grid gap-5'}>
        {Array.from({ length: panels }, (_, i) => (
          <div key={i} className="dash-panel grid gap-3">
            <Bar className="h-3 w-28" />
            <Bar className="h-7 w-40" />
            {columns === 1 && <Bar className="h-4 w-full" />}
          </div>
        ))}
      </div>
    </div>
  );
}
