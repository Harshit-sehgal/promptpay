import { expect, test } from '@playwright/test';

/**
 * Rendered-content gate (added with the A-087 fix).
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * Every quality gate in this repo points inward: typecheck, lint, unit tests,
 * migration-drift checks, dependency audits, build-secret scans, VSIX isolation
 * verification. They prove properties of the code to itself. None of them
 * asserts that a user opening a page sees the right thing.
 *
 * That blind spot shipped a real defect. The three `/legal/*` pages read their
 * bodies from repo-root `docs/legal/*.md` at request time; because `next build`
 * runs with cwd `apps/web`, the read always threw ENOENT and a `try/catch`
 * silently substituted "Content unavailable." — which was then frozen into the
 * prerendered HTML of all three statically-generated routes. They are linked
 * from the footer of every page. They had never rendered their real content in
 * any build, and 395 commits of green gates never noticed, because the code was
 * valid and the build genuinely succeeded.
 *
 * The general failure mode is "page renders, content is wrong" — an empty
 * shell, an error string, a fallback paragraph, a section that silently drops
 * out when a data source is missing. A smoke test that only asserts `h1` is
 * visible passes all of those.
 *
 * So: for each public route, assert a distinctive phrase that can only come
 * from the intended content, and fail on any known degradation marker. This is
 * cheap, and it is the gate that would have caught A-087 on the day it landed.
 *
 * These routes are unauthenticated by design — the suite needs no fixtures and
 * no API, so it stays fast and cannot flake on backend state.
 */

/** Strings that indicate a page rendered *something*, but not its content. */
const DEGRADATION_MARKERS = [
  'Content unavailable',
  'Application error',
  'This page could not be found',
  'Internal Server Error',
  'undefined',
  'NaN',
  '[object Object]',
];

interface PublicRoute {
  path: string;
  /** Phrases that can only appear if the real content rendered. */
  expect: string[];
}

const PUBLIC_ROUTES: PublicRoute[] = [
  {
    path: '/legal/cookie-policy',
    expect: ['Essential cookies', 'Analytics cookies', 'never read your code'],
  },
  {
    path: '/legal/data-retention',
    expect: ['Immutable financial ledger', 'Refresh tokens are revocable', 'Consent records'],
  },
  {
    path: '/legal/gdpr-dpa',
    expect: ['Standard Contractual Clauses', 'Art. 6(1)(b)', 'Sub-processors'],
  },
  { path: '/terms', expect: ['Acceptance', 'Fraud policy', 'Participant compensation'] },
  {
    path: '/privacy',
    expect: ['We never read your source code or prompts', 'consent records'],
  },
  {
    path: '/pricing',
    expect: ['Beta access, not commercial pricing', 'Current beta controls'],
  },
  {
    path: '/faq',
    expect: ['Frequently Asked Questions', 'What can I do in the Ateva beta?'],
  },
  {
    path: '/payout-policy',
    expect: ['Release and fraud review', 'estimated, confirmed, held'],
  },
  {
    path: '/advertiser-policy',
    expect: ['Sponsored content', 'truthful, non-deceptive'],
  },
  {
    path: '/advertisers',
    expect: ['Join the advertiser waitlist', 'founding sponsor', 'Billing is closed'],
  },
  {
    path: '/security',
    expect: ['Two-Factor Authentication', 'TOTP two-factor authentication'],
  },
  {
    path: '/comparison',
    expect: ['Tool & platform comparison', 'Supported tools'],
  },
];

test.describe('Public pages render their real content', () => {
  for (const route of PUBLIC_ROUTES) {
    test(`${route.path} serves its intended content`, async ({ page }) => {
      const response = await page.goto(route.path);
      expect(response?.status(), `${route.path} should return 200`).toBe(200);

      const body = page.locator('#main-content, main, body').first();
      const text = (await body.innerText()).replace(/\s+/g, ' ');

      for (const phrase of route.expect) {
        expect(text, `${route.path} is missing expected content: "${phrase}"`).toContain(phrase);
      }

      for (const marker of DEGRADATION_MARKERS) {
        expect(text, `${route.path} rendered a degradation marker: "${marker}"`).not.toContain(
          marker,
        );
      }

      // A page that lost its body but kept its chrome still "renders". Require
      // enough prose that an empty shell cannot pass.
      expect(text.length, `${route.path} rendered suspiciously little text`).toBeGreaterThan(400);
    });
  }
});

test.describe('Legal documents are reachable from the footer', () => {
  // A-087 shipped partly because these pages are linked everywhere but visited
  // by nobody. If a link breaks, the document is effectively unpublished even
  // when the route itself is healthy.
  const FOOTER_LEGAL_LINKS = ['/legal/cookie-policy', '/legal/data-retention'];

  for (const href of FOOTER_LEGAL_LINKS) {
    test(`footer links to ${href}`, async ({ page }) => {
      await page.goto('/');
      const link = page.locator(`footer a[href="${href}"]`).first();
      await expect(link, `footer should link to ${href}`).toHaveCount(1);
    });
  }

  test('privacy page links to the GDPR DPA', async ({ page }) => {
    await page.goto('/privacy');
    await expect(page.locator('a[href="/legal/gdpr-dpa"]').first()).toHaveCount(1);
  });
});
