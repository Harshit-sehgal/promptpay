import { NextResponse } from 'next/server';
import { apiBaseUrl } from '../_lib/cookies';

/**
 * Same-origin proxy for the API's `/auth/config` endpoint (Google Client ID
 * discovery).
 *
 * WHY a dedicated Route Handler instead of the catch-all `[...proxy]`:
 *   The login/signup pages previously fetched `${NEXT_PUBLIC_API_URL}/auth/config`
 *   directly from the browser. The API lives on a different origin (port/host),
 *   and the global CSP `connect-src 'self'` blocks any cross-origin `fetch()`,
 *   so Google Sign-In was effectively dead in production. Routing the discovery
 *   through a same-origin Route Handler keeps the fetch inside `connect-src 'self'`
 *   and never exposes the API origin to the browser.
 *
 * The response carries only the public Google Client ID (already safe to ship
 * to the client — it's how GIS knows which tenant to render). No tokens or
 * secrets traverse this path.
 */
export async function GET() {
  try {
    const res = await fetch(`${apiBaseUrl()}/auth/config`, {
      headers: { 'Content-Type': 'application/json' },
    });
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch {
    // Degrade gracefully — the client treats a failed discovery as
    // "Google sign-in unavailable" and falls back to email/password.
    return NextResponse.json(
      { message: 'Auth config unavailable', googleClientId: null },
      { status: 502 },
    );
  }
}
