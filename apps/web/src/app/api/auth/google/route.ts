import { NextRequest, NextResponse } from 'next/server';
import { logger } from '@/lib/logger';

import {
  apiBaseUrl,
  applyAuthCookies,
  applyRateLimitIdentity,
  rateLimitIdentity,
  stripAuthTokens,
} from '../_lib/cookies';
import { readLimitedJsonBody, rejectCrossOriginMutation } from '../_lib/request-guards';
import { fetchApiJson, upstreamStatus } from '../_lib/upstream';

export async function POST(req: NextRequest) {
  try {
    const blockedOrigin = rejectCrossOriginMutation(req);
    if (blockedOrigin) return blockedOrigin;
    const bodyResult = await readLimitedJsonBody(req);
    if (!bodyResult.ok) return bodyResult.response;
    const body = bodyResult.body;
    const identity = rateLimitIdentity(req);

    const googleRes = await fetchApiJson(`${apiBaseUrl()}/auth/google`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...identity.headers },
      body: JSON.stringify(body),
    });
    const googleData = googleRes.data;
    if (!googleRes.ok) {
      return applyRateLimitIdentity(
        NextResponse.json(googleData ?? {}, { status: upstreamStatus(googleRes.status) }),
        identity,
        req.headers,
      );
    }

    const { accessToken, refreshToken, user } = googleData as {
      accessToken: string;
      refreshToken: string;
      user: unknown;
    };

    // Fetch full user profile server-side
    const meRes = await fetchApiJson(`${apiBaseUrl()}/auth/me`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    let fullUser = user;
    if (meRes.ok) {
      const meData = meRes.data as Record<string, unknown> | null;
      if (meData) {
        fullUser = { ...(user as Record<string, unknown>), ...meData };
      }
    }

    const response = NextResponse.json(
      stripAuthTokens({ ...(googleData as Record<string, unknown>), user: fullUser }),
      { status: 200 },
    );
    return applyRateLimitIdentity(
      applyAuthCookies(response, { accessToken, refreshToken, headers: req.headers }),
      identity,
      req.headers,
    );
  } catch (err: unknown) {
    logger.fromError('Google OAuth route handler failed', err);
    return NextResponse.json({ message: 'Internal server error' }, { status: 500 });
  }
}
