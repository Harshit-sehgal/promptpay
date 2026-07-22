'use client';

import { useEffect, useState } from 'react';

type HealthState = 'operational' | 'degraded' | 'unknown';

async function fetchHealth(): Promise<HealthState> {
  try {
    const res = await fetch('/api/platform-health', { cache: 'no-store' });
    if (!res.ok) return 'degraded';
    const data = (await res.json()) as {
      status?: string;
      database?: string;
      redis?: { status: string };
    };
    const dbOk = data.database === 'connected';
    const redisOk = !data.redis || data.redis.status === 'connected';
    return data.status === 'ok' && dbOk && redisOk ? 'operational' : 'degraded';
  } catch {
    return 'unknown';
  }
}

export function BackendStatus() {
  const [state, setState] = useState<HealthState>('unknown');

  useEffect(() => {
    let cancelled = false;
    fetchHealth().then((result) => {
      if (!cancelled) setState(result);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const config: Record<HealthState, { label: string; dot: string; ring: string; text: string }> = {
    operational: {
      label: 'Operational',
      dot: 'bg-emerald-500',
      ring: 'bg-emerald-500/20',
      text: 'text-emerald-700',
    },
    degraded: {
      label: 'Degraded',
      dot: 'bg-amber-500',
      ring: 'bg-amber-500/20',
      text: 'text-amber-700',
    },
    unknown: {
      label: 'Status unknown',
      dot: 'bg-surface-400',
      ring: 'bg-surface-400/20',
      text: 'text-surface-600',
    },
  };

  const { label, dot, ring, text } = config[state];

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border border-surface-200/80 px-2.5 py-1 text-xs font-medium ${text} bg-white`}
      aria-label={`Platform status: ${label}`}
    >
      <span
        className={`relative inline-flex h-2 w-2 ${state === 'operational' ? 'animate-pulse' : ''}`}
      >
        <span
          className={`absolute inline-flex h-full w-full rounded-full ${ring} motion-reduce:animate-none`}
        />
        <span className={`relative inline-flex h-2 w-2 rounded-full ${dot}`} />
      </span>
      {label}
    </span>
  );
}
