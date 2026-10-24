import { useId } from 'react';

import type { PeopleSummary } from './types';

const SLOT = 20;
const BAR = 7;
const HEIGHT = 120;

function dayLabel(date: string): string {
  const parsed = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return date;
  return parsed.toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' });
}

function plural(count: number, one: string, many: string): string {
  return `${count.toLocaleString()} ${count === 1 ? one : many}`;
}

/** Text for the chart: totals, and the busiest day when anything happened. */
export function summariseSignups(days: PeopleSummary['signupsByDay']): string {
  if (days.length === 0) return 'No signup data for the last 30 days.';
  const users = days.reduce((sum, d) => sum + d.users, 0);
  const waitlist = days.reduce((sum, d) => sum + d.waitlist, 0);
  const first = dayLabel(days[0]!.date);
  const last = dayLabel(days[days.length - 1]!.date);
  let text = `${first} to ${last}: ${plural(users, 'registration', 'registrations')} and ${plural(waitlist, 'waitlist signup', 'waitlist signups')}.`;
  const busiest = days.reduce((best, d) =>
    d.users + d.waitlist > best.users + best.waitlist ? d : best,
  );
  if (busiest.users + busiest.waitlist > 0) {
    text += ` Busiest day ${dayLabel(busiest.date)}: ${busiest.users.toLocaleString()} registered, ${busiest.waitlist.toLocaleString()} on the waitlist.`;
  }
  return text;
}

/**
 * Daily signups as paired bars: filled for registrations, outlined for
 * waitlist, so the two read apart without relying on colour.
 */
export function SignupsChart({ days }: { days: PeopleSummary['signupsByDay'] }) {
  const summaryId = useId();
  const highest = Math.max(0, ...days.flatMap((d) => [d.users, d.waitlist]));
  const peak = Math.max(1, highest);
  const width = Math.max(1, days.length) * SLOT;
  const scale = (value: number) => (value / peak) * (HEIGHT - 2);

  return (
    <figure className="people-chart">
      <svg
        viewBox={`0 0 ${width} ${HEIGHT}`}
        preserveAspectRatio="none"
        role="img"
        aria-labelledby={summaryId}
        className="people-chart__svg"
      >
        {days.map((day, index) => {
          const x = index * SLOT + (SLOT - BAR * 2 - 1) / 2;
          const usersH = scale(day.users);
          const waitH = scale(day.waitlist);
          return (
            <g key={day.date}>
              <title>
                {`${dayLabel(day.date)}: ${day.users} registered, ${day.waitlist} on the waitlist`}
              </title>
              <rect x={index * SLOT} y={0} width={SLOT} height={HEIGHT} fill="transparent" />
              {day.users > 0 && (
                <rect
                  className="people-chart__users"
                  x={x}
                  y={HEIGHT - usersH}
                  width={BAR}
                  height={usersH}
                />
              )}
              {day.waitlist > 0 && (
                <rect
                  className="people-chart__waitlist"
                  x={x + BAR + 1}
                  y={HEIGHT - waitH}
                  width={BAR}
                  height={waitH}
                />
              )}
            </g>
          );
        })}
        <line className="people-chart__base" x1={0} x2={width} y1={HEIGHT} y2={HEIGHT} />
      </svg>
      <div className="people-chart__axis" aria-hidden="true">
        <span>{days.length > 0 ? dayLabel(days[0]!.date) : ''}</span>
        <span>Highest day {highest.toLocaleString()}</span>
        <span>{days.length > 0 ? dayLabel(days[days.length - 1]!.date) : ''}</span>
      </div>
      <figcaption id={summaryId} className="people-chart__summary">
        {summariseSignups(days)}
      </figcaption>
      <ul className="people-chart__legend" aria-hidden="true">
        <li>
          <span className="people-chart__key people-chart__key--users" /> Registered
        </li>
        <li>
          <span className="people-chart__key people-chart__key--waitlist" /> Waitlist
        </li>
      </ul>
    </figure>
  );
}
