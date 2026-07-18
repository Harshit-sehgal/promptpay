import { expect, test } from '@playwright/test';

/**
 * Live security header verification (P1 #16).
 *
 * These tests hit real Next.js responses and assert that the expected
 * security headers are present, including the Content-Security-Policy
 * required for Google sign-in (A-018) and other Helmet-provided headers.
 */

test('homepage response carries required security headers', async ({ page }) => {
  const response = await page.goto('/');
  expect(response).not.toBeNull();

  const headers = response!.headers();
  expect(headers['content-security-policy']).toBeDefined();
  expect(headers['x-content-type-options']).toBe('nosniff');
  expect(headers['x-frame-options']).toBeDefined();
  expect(headers['referrer-policy']).toBeDefined();
});

test('CSP allows Google sign-in frame-src and script-src (A-018)', async ({ page }) => {
  const response = await page.goto('/');
  const csp = response!.headers()['content-security-policy'];
  expect(csp).toBeDefined();

  // Google sign-in loads an iframe from accounts.google.com and a script from
  // the Google Identity Services CDN. Parse directives so the test is not
  // sensitive to source ordering or extra sources.
  const directives = Object.fromEntries(
    csp
      .split(';')
      .map((d) => d.trim())
      .filter(Boolean)
      .map((d) => d.split(/\s+/))
      .map(([name, ...values]) => [name, values]),
  );

  expect(directives['frame-src']).toContain("'self'");
  expect(directives['frame-src']).toContain('https://accounts.google.com');
  expect(directives['script-src']).toContain("'self'");
  expect(directives['script-src']).toContain("'unsafe-inline'");
  expect(directives['script-src']).toContain('https://accounts.google.com/gsi/client');
});

test('CSP disallows object embeds and restricts frames', async ({ page }) => {
  const response = await page.goto('/');
  const csp = response!.headers()['content-security-policy'];
  expect(csp).toBeDefined();

  const directives = Object.fromEntries(
    csp
      .split(';')
      .map((d) => d.trim())
      .filter(Boolean)
      .map((d) => d.split(/\s+/))
      .map(([name, ...values]) => [name, values]),
  );

  expect(directives['object-src']).toEqual(["'none'"]);
  expect(directives['frame-ancestors']).toEqual(["'none'"]);
  expect(directives['base-uri']).toContain("'self'");
  expect(directives['form-action']).toContain("'self'");
});

test('API proxy route does not leak Set-Cookie or Authorization in CSP', async ({ page }) => {
  // The CSP header should not contain sensitive values; this is a sanity check
  // that the header is composed of policy directives, not request data.
  const response = await page.goto('/');
  const csp = response!.headers()['content-security-policy'];
  expect(csp).toBeDefined();
  expect(csp).not.toContain('Bearer');
  expect(csp).not.toContain('Set-Cookie');
});
