import { NextResponse } from 'next/server';

import { apiBaseUrl } from '../auth/_lib/cookies';

export const dynamic = 'force-dynamic';

const HEALTH_TIMEOUT_MS = 4_000;

/**
 * Public, read-only bridge to the API's health contract.
 *
 * `/api/health` belongs to this Next.js application and is intentionally a
 * lightweight web-process check. The status UI needs the independent API
 * health result, so it calls this route rather than accidentally treating the
 * web process as the reward-platform backend.
 */
export async function GET() {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), HEALTH_TIMEOUT_MS);

  try {
    const upstream = await fetch(`${apiBaseUrl()}/health`, {
      headers: { Accept: 'application/json' },
      cache: 'no-store',
      signal: controller.signal,
    });

    const contentType = upstream.headers.get('content-type') ?? '';
    if (!contentType.includes('application/json')) {
      throw new Error('Health endpoint returned a non-JSON response');
    }

    return NextResponse.json(await upstream.json(), {
      status: upstream.status,
      headers: { 'Cache-Control': 'no-store, max-age=0' },
    });
  } catch (error) {
    const timedOut = error instanceof Error && error.name === 'AbortError';
    return NextResponse.json(
      {
        status: 'unavailable',
        timestamp: new Date().toISOString(),
        message: timedOut ? 'Backend health check timed out' : 'Backend health check unavailable',
      },
      { status: 503, headers: { 'Cache-Control': 'no-store, max-age=0' } },
    );
  } finally {
    clearTimeout(timeout);
  }
}
