'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { systemApi } from '@/lib/api/services';

interface HealthData {
  status: string;
  timestamp: string;
  uptimeSeconds: number;
  database: string | { status: string; error: string };
  redis?: {
    status: 'connected' | 'error' | 'not_configured';
    latencyMs?: number;
    error?: string;
  };
}

export default function StatusPage() {
  const [data, setData] = useState<HealthData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchHealth = () => {
    setLoading(true);
    systemApi.getHealth()
      .then((res) => {
        setData(res.data);
        setError(null);
      })
      .catch(() => {
        setError('Failed to query system status. The gateway might be offline.');
      })
      .finally(() => {
        setLoading(false);
      });
  };

  useEffect(() => {
    fetchHealth();
    const interval = setInterval(fetchHealth, 15000);
    return () => clearInterval(interval);
  }, []);

  const dbConnected = data?.database === 'connected';
  const redisConnected = data?.redis?.status === 'connected';
  const overallHealthy = dbConnected && (!data?.redis || redisConnected);

  return (
    <div className="min-h-screen bg-white">
      {/* Navigation */}
      <nav className="fixed top-0 left-0 right-0 z-50 glass-nav border-b border-surface-200/80">
        <div className="mx-auto max-w-6xl px-6 py-3.5 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2.5 group">
            <div className="w-7 h-7 rounded-md bg-brand-500 flex items-center justify-center text-white font-bold text-xs shadow-sm">
              W
            </div>
            <span className="text-surface-900 font-semibold text-[15px] tracking-tight">WaitLayer</span>
          </Link>
          <Link href="/" className="text-surface-500 hover:text-surface-900 text-[14px] transition-colors">
            ← Back to Home
          </Link>
        </div>
      </nav>

      {/* Main content */}
      <main className="pt-32 pb-24 px-6 mx-auto max-w-3xl">
        <div className="text-center mb-12">
          <h1 className="text-4xl font-bold text-surface-900 tracking-tight mb-4">System Status</h1>
          <p className="text-surface-500 text-sm">
            Live health checks of the WaitLayer reward engine and backend systems.
          </p>
        </div>

        {loading && !data ? (
          <div className="flex flex-col items-center justify-center py-20">
            <div className="w-8 h-8 border-2 border-brand-500 border-t-transparent rounded-full animate-spin mb-4" />
            <p className="text-surface-500 text-xs">Querying nodes...</p>
          </div>
        ) : error ? (
          <div className="bg-rose-50 border border-rose-200 rounded-2xl p-6 text-center">
            <p className="text-rose-600 font-semibold text-sm mb-2">{error}</p>
            <button
              onClick={fetchHealth}
              className="text-rose-700 hover:text-rose-800 text-xs font-semibold underline"
            >
              Retry connection
            </button>
          </div>
        ) : (
          <div className="space-y-6">
            {/* Overall status banner */}
            <div className={`p-6 rounded-2xl border transition-all duration-300 flex items-center gap-4 ${
              overallHealthy
                ? 'bg-emerald-50/50 border-emerald-200/60 text-emerald-800'
                : 'bg-rose-50/50 border-rose-200/60 text-rose-800'
            }`}>
              <div className={`w-3.5 h-3.5 rounded-full shrink-0 ${
                overallHealthy ? 'bg-emerald-500 animate-pulse' : 'bg-rose-500'
              }`} />
              <div>
                <p className="font-bold text-sm">
                  {overallHealthy ? 'All Systems Operational' : 'Degraded Performance'}
                </p>
                <p className="text-xs opacity-80 mt-0.5">
                  Last checked: {data ? new Date(data.timestamp).toLocaleTimeString() : 'Unknown'}
                </p>
              </div>
            </div>

            {/* Service detail cards */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Database Status */}
              <div className="bg-white border border-surface-200 rounded-2xl p-6 shadow-sm hover:border-brand-300 transition-colors duration-250">
                <div className="flex items-center justify-between mb-4">
                  <span className="text-surface-900 font-semibold text-[14px]">Primary Database</span>
                  <span className={`text-[11px] font-bold px-2.5 py-0.5 rounded-full ${
                    dbConnected ? 'bg-emerald-50 text-emerald-700 border border-emerald-200/50' : 'bg-rose-50 text-rose-700 border border-rose-200/50'
                  }`}>
                    {dbConnected ? 'Online' : 'Offline'}
                  </span>
                </div>
                <p className="text-surface-500 text-xs leading-relaxed">
                  PostgreSQL cluster storing ledger tables, referral chains, and configurations.
                </p>
              </div>

              {/* Redis Cache & Rate Limiting Status */}
              <div className="bg-white border border-surface-200 rounded-2xl p-6 shadow-sm hover:border-brand-300 transition-colors duration-250">
                <div className="flex items-center justify-between mb-4">
                  <span className="text-surface-900 font-semibold text-[14px]">Redis Cache & Rate Limiter</span>
                  <span className={`text-[11px] font-bold px-2.5 py-0.5 rounded-full ${
                    redisConnected ? 'bg-emerald-50 text-emerald-700 border border-emerald-200/50' : 'bg-rose-50 text-rose-700 border border-rose-200/50'
                  }`}>
                    {redisConnected ? 'Online' : 'Offline'}
                  </span>
                </div>
                <p className="text-surface-500 text-xs leading-relaxed">
                  Memory backing store for brute-force tracking, request throttling, and session tokens.
                  {data?.redis?.latencyMs !== undefined && ` Latency: ${data.redis.latencyMs}ms`}
                </p>
              </div>
            </div>

            {/* Infrastructure specifications */}
            <div className="bg-surface-50/50 border border-surface-200/60 rounded-2xl p-6 space-y-4">
              <h3 className="text-surface-950 font-bold text-xs uppercase tracking-wider">Metrics</h3>
              <div className="grid grid-cols-2 gap-4 text-xs">
                <div>
                  <p className="text-surface-400">Uptime</p>
                  <p className="text-surface-800 font-medium mt-0.5">
                    {data ? `${Math.floor(data.uptimeSeconds / 3600)}h ${Math.floor((data.uptimeSeconds % 3600) / 60)}m` : 'Unknown'}
                  </p>
                </div>
                <div>
                  <p className="text-surface-400">Environment</p>
                  <p className="text-surface-800 font-medium mt-0.5">Production Nodes</p>
                </div>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
