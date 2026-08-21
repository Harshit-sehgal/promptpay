#!/usr/bin/env node
/**
 * Secret-safe smoke test for the external advertiser review journey.
 *
 * Required environment:
 *   REVIEW_BASE_URL=https://www.waitlayer.com
 *   REVIEW_EMAIL=<dedicated advertiser review account>
 *   REVIEW_ACCOUNT_PASSWORD=<password>
 *
 * The script never prints credentials, cookies, auth bodies, or provider data.
 */

const REVIEW_CAMPAIGN_NAME = 'WaitLayer product review — draft campaign';

function fail(message) {
  console.error(`review-access-smoke: ${message}`);
  process.exit(1);
}

function publicHttpsOrigin(value) {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    if (
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      !['', '/'].includes(url.pathname) ||
      ['localhost', '127.0.0.1', '::1'].includes(host)
    ) {
      return null;
    }
    return url.origin;
  } catch {
    return null;
  }
}

function getSetCookie(headers) {
  if (typeof headers.getSetCookie === 'function') return headers.getSetCookie();
  const single = headers.get('set-cookie');
  return single ? [single] : [];
}

function cookieHeader(setCookieValues) {
  return setCookieValues
    .map((value) => value.split(';', 1)[0]?.trim())
    .filter(Boolean)
    .join('; ');
}

async function readJsonSafe(response) {
  const type = response.headers.get('content-type') ?? '';
  if (!type.includes('application/json')) return null;
  try {
    return await response.json();
  } catch {
    return null;
  }
}

async function main() {
  const baseUrl = publicHttpsOrigin(process.env.REVIEW_BASE_URL ?? '');
  if (!baseUrl) fail('REVIEW_BASE_URL must be a public HTTPS origin');

  const email = (process.env.REVIEW_EMAIL ?? '').trim().toLowerCase();
  const password = process.env.REVIEW_ACCOUNT_PASSWORD ?? '';
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) fail('REVIEW_EMAIL is invalid or missing');
  if (!password) fail('REVIEW_ACCOUNT_PASSWORD is missing');

  const configResponse = await fetch(`${baseUrl}/api/auth/config`, {
    redirect: 'manual',
    headers: { Accept: 'application/json' },
  });
  if (!configResponse.ok) {
    fail(`/api/auth/config returned HTTP ${configResponse.status}`);
  }
  console.log('✓ web auth configuration is reachable');

  const loginResponse = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    redirect: 'manual',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Origin: baseUrl,
    },
    body: JSON.stringify({ email, password }),
  });
  const loginBody = await readJsonSafe(loginResponse);
  if (!loginResponse.ok) {
    fail(`review login returned HTTP ${loginResponse.status}`);
  }
  const role = loginBody?.user?.role;
  if (role !== 'advertiser') fail(`review login returned unexpected role ${String(role)}`);

  const cookies = cookieHeader(getSetCookie(loginResponse.headers));
  if (!cookies) fail('login succeeded but no auth cookies were issued');
  console.log('✓ dedicated reviewer login succeeds as advertiser');

  const campaignsResponse = await fetch(`${baseUrl}/api/advertiser/campaigns?limit=50`, {
    redirect: 'manual',
    headers: { Accept: 'application/json', Cookie: cookies },
  });
  const campaignsBody = await readJsonSafe(campaignsResponse);
  if (!campaignsResponse.ok) {
    fail(`advertiser campaigns returned HTTP ${campaignsResponse.status}`);
  }

  const rows = Array.isArray(campaignsBody)
    ? campaignsBody
    : Array.isArray(campaignsBody?.items)
      ? campaignsBody.items
      : Array.isArray(campaignsBody?.data)
        ? campaignsBody.data
        : [];
  const reviewCampaign = rows.find((campaign) => campaign?.name === REVIEW_CAMPAIGN_NAME);
  if (!reviewCampaign) fail('review draft campaign is not visible through advertiser API');
  if (reviewCampaign.status !== 'draft') {
    fail(`review campaign must stay draft, got ${String(reviewCampaign.status)}`);
  }
  console.log('✓ inert review campaign is visible and remains draft');

  const dashboardResponse = await fetch(`${baseUrl}/advertiser`, {
    redirect: 'manual',
    headers: { Cookie: cookies },
  });
  if (dashboardResponse.status >= 300 && dashboardResponse.status < 400) {
    fail(`advertiser dashboard redirected with HTTP ${dashboardResponse.status}`);
  }
  if (!dashboardResponse.ok) {
    fail(`advertiser dashboard returned HTTP ${dashboardResponse.status}`);
  }
  console.log('✓ authenticated advertiser dashboard is reachable');

  console.log('review-access-smoke: PASS');
}

main().catch((error) => {
  console.error(
    `review-access-smoke: ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exitCode = 1;
});
