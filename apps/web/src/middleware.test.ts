import { SignJWT } from 'jose';
import { NextRequest } from 'next/server';
import { afterEach, describe, expect, it } from 'vitest';

import { middleware } from './middleware';

const SECRET = 'test-secret-at-least-32-characters-long-0123456789';
const OTHER_SECRET = 'other-secret-at-least-32-characters-long-0123456';

function makeReq(token?: string): NextRequest {
  const req = new NextRequest(new URL('https://app.example/developer'), {});
  if (token) req.cookies.set('access_token', token);
  return req;
}

async function makeToken(secret: string): Promise<string> {
  return new SignJWT({ sub: 'u1', role: 'developer' })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject('u1')
    .sign(new TextEncoder().encode(secret));
}

function isRedirect(res: Response): boolean {
  return res.status === 307 || res.headers.get('location') !== null;
}

describe('protected-route middleware JWT_SECRET (A-016)', () => {
  const original = process.env.JWT_SECRET;

  afterEach(() => {
    if (original === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = original;
  });

  it('allows a valid token signed with the configured secret', async () => {
    process.env.JWT_SECRET = SECRET;
    const token = await makeToken(SECRET);
    const res = await middleware(makeReq(token));
    expect(isRedirect(res)).toBe(false);
  });

  it('redirects when JWT_SECRET does not match the token signature', async () => {
    process.env.JWT_SECRET = OTHER_SECRET;
    const token = await makeToken(SECRET);
    const res = await middleware(makeReq(token));
    expect(isRedirect(res)).toBe(true);
  });

  it('redirects when JWT_SECRET is missing', async () => {
    delete process.env.JWT_SECRET;
    const token = await makeToken(SECRET);
    const res = await middleware(makeReq(token));
    expect(isRedirect(res)).toBe(true);
  });

  it('redirects a forged refresh cookie with no access token (bypass closed)', async () => {
    process.env.JWT_SECRET = SECRET;
    const req = makeReq();
    // Attacker tries to satisfy the old "any refresh value passes" branch.
    req.cookies.set('refresh_token', 'forged-value');
    const res = await middleware(req);
    expect(isRedirect(res)).toBe(true);
  });

  it('passes through a valid signed refresh cookie with no access token', async () => {
    process.env.JWT_SECRET = SECRET;
    const refresh = await makeToken(SECRET); // any secret-signed JWT works as refresh
    const req = makeReq();
    req.cookies.set('refresh_token', refresh);
    const res = await middleware(req);
    expect(isRedirect(res)).toBe(false);
  });
});
