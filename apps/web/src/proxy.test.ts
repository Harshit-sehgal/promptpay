import { importPKCS8, SignJWT } from 'jose';
import { NextRequest } from 'next/server';
import { afterEach, describe, expect, it } from 'vitest';

import { proxy } from './proxy';

// Test RSA key pair for RS256. These are low-security test keys only.
const TEST_JWT_PRIVATE_KEY = `-----BEGIN PRIVATE KEY-----
MIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgwggSkAgEAAoIBAQDibBOaf5Tnpf6q
gI1gx0gEorME52TzSfj7dS7LTGfsK48xIfSypU5ZilMjROw34iE6ORGaaNYJ50gT
RhZ7GeWRDJbp+kYi6hl1X54zWlxz/192liD5BclHj8UcedWqF1X/qlO/svJSVf8M
GLXColVEjNP36363oIlhvG2jp0ops939EuUrtY6lgRhnJx6pORiadGvKRUn+DO7k
K9T4b2qLdtX2cpAfMrDKCN4IHoasaPTVrZQL9xJ4ZQ+Tm70IlnK3rGE5Tn6+Sn3e
Vd3+aLCCh/drza3/y2dx0v1exJOFfK5Bt5NMxVRAWjdRUDI+HJdVjCLtplw5bGUn
iPQAliNbAgMBAAECggEAEd17Mn6MjjaPwH5CKXev3AXGYEWttnCIv7aASbQuovjQ
5IyMVSgr5W6/npHKnaIvAvwLwoYxFTj1e+fU0EO71FUM90szC4AzIAq6XczsbI6i
xqWT1nI5bncOk2+dhz0uIO0cjIyfCBYW+KpedQv/9Fe0ReSD7BMzo82NTRNfC6kq
ecQl0DkCo0wF63sHAyhuqQwFpuBFtB/EwWRAeYMZxJ/BMEo99kXTd7XaV39qbv2i
fO+DNG8IgoTQRXUpcGvl/2L8tnzfE2Qro3fCq05xRwBMhhxuUxL+p48uvshpm1FP
k37urpWW+Zwp+qIBqzt8wOaDflwoZahcRVWgBgabOQKBgQD876Ku3EFr8TFeVINn
/iKkg70LVEqI4MK2POwYW1bQE3nAwT86ad2ogvyJSZbeka9qX9mhcYKxFKw0fTFT
eFNklB9pq8935W2PxTWDLbCePAdmIR54CiPPNqRzM8ayf/YVJpCYL874SIYmjjQY
gBu3zvYggXFC0WQf7s71paAJFwKBgQDlKjhwUGcr8mjqRH7bJUxTcKLyBB4S1KPV
rmCqW3iVVWgs611N3Fqjs9kwF4F4wXXkChnYK1lzlKsacWNJ2an1kcDxvKW2lV96
ayO25Q+SFIVxVuozjumAcMGcCqfqcPWyXTgAod/0Vx9JaHaiOIZxgJUZTRW5Upub
Ouj1Nr2aXQKBgQDM2+oPZiU2n+s0U476s0KrrGd4vZSAuEn7/+vY7mGptZxvGhVz
4jq9ORoAt7GSIrzIk0lZEO6hLfUrrho9WL9yPuYSWC15FkFeqINm86KRBl2XwktD
PjMyqTcYd17/Q9Sz3MBQAqjHPzYoFBTtoxTQErgWK8DoNV+63ViSbMrpkQKBgQCN
95HvQmAoAYytVLGh4YFfT7AibhqTX9f/UH/iCbiyCq725Phwe8pLD+fEu0siG/eE
xh0spe5MhBVb1FLGNWntD9aP62ZdrjvwAt+lNlJnFP92L3n3ZtmREElg+dj8i+4q
CUXgXmf3XuGrAGQ+KvZe6mFzwyVqIZr0l5IqFzduoQKBgF4JsvH/Cf/t9gDwUhCK
ewt/YllC4ooH9ZvbDXsW/GnP+zW4D2UKRq/8xCAUnBZZIycV4xZeXQTWj1H0gAFe
Tx+aVsKQzTAS3gIl0B5OV1jjo87CQRrovoiOsa3z0G/ty+cKJjLAza8Kd42CKnhs
RzYsUtSNKBt6HbKgkJzrUqLP
-----END PRIVATE KEY-----`;

const TEST_JWT_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA4mwTmn+U56X+qoCNYMdI
BKKzBOdk80n4+3Uuy0xn7CuPMSH0sqVOWYpTI0TsN+IhOjkRmmjWCedIE0YWexnl
kQyW6fpGIuoZdV+eM1pcc/9fdpYg+QXJR4/FHHnVqhdV/6pTv7LyUlX/DBi1wqJV
RIzT9+t+t6CJYbxto6dKKbPd/RLlK7WOpYEYZyceqTkYmnRrykVJ/gzu5CvU+G9q
i3bV9nKQHzKwygjeCB6GrGj01a2UC/cSeGUPk5u9CJZyt6xhOU5+vkp93lXd/miw
gof3a82t/8tncdL9XsSThXyuQbeTTMVUQFo3UVAyPhyXVYwi7aZcOWxlJ4j0AJYj
WwIDAQAB
-----END PUBLIC KEY-----`;

// A different valid RSA public key so we can test a real signature mismatch.
const OTHER_JWT_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA+Mt8y5LDwNuPJiJU1lwA
fJp8x42YWuVEkZWwTgcYlkaTi8kSEp5vZOwmWJhlp/AiHy8aLGMbjuwRt3w99xlv
KUmmNfQZWDzdnhd34aJfnAGTboALhnP25vDiRwXRxi2UrMr5skWDUpFNR1mCLMud
HtnlMvxo1NZJLfFlCTrCDDf1NxAy8Vsg9LHBRVxFR1eDpDmzgafGZc6VIgJQEvGk
m/t7JgR/uuidPDXe1zknYXMTe3PVO3Ls8Yr/Kq3c5Rd8Z3djslzLFHc/X4oroQKH
eZWbjjlaBNxmNE+Dz3Dk5bes5sjkPeXtCTDfHmf4Lgatwf451Ktt6VPSG3iFS/9k
UwIDAQAB
-----END PUBLIC KEY-----`;

const TEST_JWT_SECRET = 'test-secret-at-least-32-characters-long-0123456789';

function makeReq(token?: string): NextRequest {
  const req = new NextRequest(new URL('https://app.example/developer'), {});
  // The middleware only trusts the host-bound, Secure-only `__Host-` cookie in
  // production (https); a bare `access_token` is only read over a non-secure
  // connection. The test exercises the realistic, secure path.
  if (token) req.cookies.set('__Host-access_token', token);
  return req;
}

async function makeToken(aud: string = 'access'): Promise<string> {
  const privateKey = await importPKCS8(TEST_JWT_PRIVATE_KEY.replace(/\\n/g, '\n'), 'RS256');
  return new SignJWT({ sub: 'u1', role: 'developer' })
    .setProtectedHeader({ alg: 'RS256', typ: 'JWT', kid: 'test-kid-1' })
    .setSubject('u1')
    .setIssuer('waitlayer')
    .setAudience(['waitlayer-client', aud])
    .setJti('jti-test-1')
    .sign(privateKey);
}

function isRedirect(res: Response): boolean {
  return res.status === 307 || res.headers.get('location') !== null;
}

describe('protected-route proxy JWT_PUBLIC_KEY (A-016)', () => {
  const originalPublicKey = process.env.JWT_PUBLIC_KEY;
  const originalSecret = process.env.JWT_SECRET;

  afterEach(() => {
    if (originalPublicKey === undefined) delete process.env.JWT_PUBLIC_KEY;
    else process.env.JWT_PUBLIC_KEY = originalPublicKey;
    if (originalSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = originalSecret;
  });

  it('allows a valid token signed with the configured private key', async () => {
    process.env.JWT_PUBLIC_KEY = TEST_JWT_PUBLIC_KEY;
    process.env.JWT_SECRET = TEST_JWT_SECRET;
    const token = await makeToken();
    const res = await proxy(makeReq(token));
    expect(isRedirect(res)).toBe(false);
  });

  it('redirects when JWT_PUBLIC_KEY does not match the token signature', async () => {
    process.env.JWT_PUBLIC_KEY = OTHER_JWT_PUBLIC_KEY;
    process.env.JWT_SECRET = TEST_JWT_SECRET;
    const token = await makeToken();
    const res = await proxy(makeReq(token));
    expect(isRedirect(res)).toBe(true);
  });

  it('redirects when JWT_PUBLIC_KEY is missing', async () => {
    delete process.env.JWT_PUBLIC_KEY;
    process.env.JWT_SECRET = TEST_JWT_SECRET;
    const token = await makeToken();
    const res = await proxy(makeReq(token));
    expect(isRedirect(res)).toBe(true);
  });

  it('redirects a forged refresh cookie with no access token (bypass closed)', async () => {
    process.env.JWT_PUBLIC_KEY = TEST_JWT_PUBLIC_KEY;
    process.env.JWT_SECRET = TEST_JWT_SECRET;
    const req = makeReq();
    // Attacker tries to satisfy the old "any refresh value passes" branch.
    req.cookies.set('__Host-refresh_token', 'forged-value');
    const res = await proxy(req);
    expect(isRedirect(res)).toBe(true);
  });

  it('passes through a valid signed refresh cookie with no access token', async () => {
    process.env.JWT_PUBLIC_KEY = TEST_JWT_PUBLIC_KEY;
    process.env.JWT_SECRET = TEST_JWT_SECRET;
    const refresh = await makeToken('refresh'); // refresh-typed JWT works as refresh
    const req = makeReq();
    req.cookies.set('__Host-refresh_token', refresh);
    const res = await proxy(req);
    expect(isRedirect(res)).toBe(false);
  });
});
