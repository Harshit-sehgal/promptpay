'use client';

import { useSearchParams } from 'next/navigation';
import { Suspense, useCallback, useEffect, useState } from 'react';
import { PersonDetailDialog } from '@/components/admin/people/person-detail';
import { EMPTY_QUERY, parseQuery, serialiseQuery } from '@/components/admin/people/query';
import { RegisteredTab } from '@/components/admin/people/registered-tab';
import { SignupsChart } from '@/components/admin/people/signups-chart';
import type { PeopleQuery, PeopleSummary, PeopleTab } from '@/components/admin/people/types';
import { WaitlistTab } from '@/components/admin/people/waitlist-tab';
import { Notice, PageHeader, Panel, PanelHeader, Stat } from '@/components/dash';
import { getErrorMessage } from '@/lib/api/errors';
import { adminApi } from '@/lib/api/services';

function PeopleView() {
  const searchParams = useSearchParams();
  const [query, setQuery] = useState<PeopleQuery>(() => parseQuery(searchParams));
  const [openUserId, setOpenUserId] = useState<string | null>(null);
  const [summary, setSummary] = useState<PeopleSummary | null>(null);
  const [summaryError, setSummaryError] = useState<string | null>(null);
  const [summaryAttempt, setSummaryAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setSummaryError(null);
    adminApi
      .getPeopleSummary()
      .then((res: { data: PeopleSummary }) => {
        if (!cancelled) setSummary(res.data);
      })
      .catch((err: unknown) => {
        if (!cancelled) setSummaryError(getErrorMessage(err, 'Failed to load the people summary'));
      });
    return () => {
      cancelled = true;
    };
  }, [summaryAttempt]);

  // Follow navigations that change the query from outside this view, such as
  // the sidebar link back to the bare page.
  const paramString = searchParams.toString();
  useEffect(() => {
    const next = parseQuery(new URLSearchParams(paramString));
    setQuery((current) => (serialiseQuery(current) === serialiseQuery(next) ? current : next));
  }, [paramString]);

  // Mirror the view into the address bar so it can be shared.
  useEffect(() => {
    const qs = serialiseQuery(query);
    const next = `${window.location.pathname}${qs ? `?${qs}` : ''}`;
    if (next !== `${window.location.pathname}${window.location.search}`) {
      window.history.replaceState(window.history.state, '', next);
    }
  }, [query]);

  const patchQuery = useCallback(
    (patch: Partial<PeopleQuery>) => setQuery((current) => ({ ...current, page: 1, ...patch })),
    [],
  );
  const switchTab = (tab: PeopleTab) => setQuery({ ...EMPTY_QUERY, tab });
  const refreshSummary = useCallback(() => setSummaryAttempt((n) => n + 1), []);
  // Bumped after a tag edit so the rows and the tag filter reload.
  const [tagVersion, setTagVersion] = useState(0);
  const tagsChanged = useCallback(() => setTagVersion((n) => n + 1), []);
  const closeDetail = useCallback(() => setOpenUserId(null), []);

  const users = summary?.users;
  const waitlist = summary?.waitlist;
  const figure = (value: number | undefined) =>
    value === undefined ? '-' : value.toLocaleString();

  return (
    <>
      <PageHeader title="People" />

      {summaryError && (
        <Notice
          tone="bad"
          role="alert"
          actions={
            <button
              type="button"
              onClick={refreshSummary}
              className="dash-btn dash-btn--secondary dash-btn--sm"
            >
              Retry
            </button>
          }
        >
          {summaryError}
        </Notice>
      )}

      <div className="dash-grid dash-grid--4">
        <Panel label="Registered users">
          <Stat
            label="Registered"
            value={figure(users?.total)}
            detail={users ? `${users.emailVerified.toLocaleString()} email verified` : undefined}
          />
        </Panel>
        <Panel label="Registered in the last 7 days">
          <Stat
            label="New in 7 days"
            value={figure(users?.last7d)}
            detail={users ? `${users.last30d.toLocaleString()} in 30 days` : undefined}
          />
        </Panel>
        <Panel label="Waitlist signups">
          <Stat
            label="Waitlist"
            value={figure(waitlist?.total)}
            detail={waitlist ? `${waitlist.last7d.toLocaleString()} in 7 days` : undefined}
          />
        </Panel>
        <Panel label="Waitlist pending">
          <Stat
            label="Waitlist pending"
            value={figure(waitlist?.byStatus.pending)}
            detail={
              waitlist ? `${(waitlist.byStatus.invited ?? 0).toLocaleString()} invited` : undefined
            }
          />
        </Panel>
      </div>

      <Panel label="Signups in the last 30 days">
        <PanelHeader title="Signups, last 30 days" />
        {summary ? (
          <SignupsChart days={summary.signupsByDay} />
        ) : (
          <p className="text-sm text-[var(--muted)]" role="status">
            {summaryError ? 'The chart needs the summary above.' : 'Loading the chart.'}
          </p>
        )}
      </Panel>

      <div
        className="dash-bar flex flex-wrap items-center gap-x-5 gap-y-1"
        role="group"
        aria-label="List"
      >
        {(
          [
            ['registered', 'Registered', users?.total],
            ['waitlist', 'Waitlist', waitlist?.total],
          ] as const
        ).map(([tab, name, count]) => (
          <button
            key={tab}
            type="button"
            aria-pressed={query.tab === tab}
            onClick={() => switchTab(tab)}
            className="dash-btn dash-btn--ghost dash-btn--sm"
          >
            {name}
            {count !== undefined && (
              <span className="dash-mono text-xs font-normal">{count.toLocaleString()}</span>
            )}
          </button>
        ))}
      </div>

      {query.tab === 'registered' ? (
        <RegisteredTab
          query={query}
          onQuery={patchQuery}
          onOpen={setOpenUserId}
          version={tagVersion}
        />
      ) : (
        <WaitlistTab
          query={query}
          summary={summary}
          onQuery={patchQuery}
          onOpen={setOpenUserId}
          onStatusChanged={refreshSummary}
          version={tagVersion}
          onTagsChanged={tagsChanged}
        />
      )}

      <PersonDetailDialog
        userId={openUserId}
        onClose={closeDetail}
        onOpenUser={setOpenUserId}
        onTagsChanged={tagsChanged}
      />
    </>
  );
}

export default function AdminPeoplePage() {
  return (
    <Suspense fallback={null}>
      <PeopleView />
    </Suspense>
  );
}
