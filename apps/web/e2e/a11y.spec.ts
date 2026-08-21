import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

/**
 * Accessibility smoke tests (WCAG 2.1 AA).
 *
 * Scans the key public pages with axe-core for violations of the WCAG 2.1 AA
 * standard: color contrast, missing labels, heading hierarchy, ARIA
 * correctness, keyboard-focusable controls, etc. Serious and critical
 * violations fail CI; lower-impact findings remain visible as test annotations.
 *
 * We scan the public (unauthenticated) pages because they are the entry point
 * for every visitor and carry the highest a11y liability. Authenticated pages
 * are covered by the component-level vitest suites + the smoke E2E.
 *
 * EVERY public page must be listed. This was a subset of 13 while 8 public
 * pages — including all three /legal/* documents and the two policy pages —
 * had shipped without ever being added. Legal and policy text is precisely
 * where an accessibility failure matters most, since it is the content a
 * screen-reader user is most likely to need. `a11y-coverage.test.ts` derives
 * the expected set from the filesystem and fails if a public route is missing
 * here, so the list cannot silently fall behind again.
 */

const PAGES = [
  '/',
  '/pricing',
  '/advertisers',
  '/privacy',
  '/terms',
  '/comparison',
  '/contact',
  '/feedback',
  '/security',
  '/status',
  '/faq',
  '/manifesto',
  '/changelog',
  '/payout-policy',
  '/advertiser-policy',
  '/legal/cookie-policy',
  '/legal/data-retention',
  '/legal/gdpr-dpa',
  '/auth/login',
  '/auth/signup',
  '/auth/forgot-password',
  '/auth/reset-password?token=accessibility-check',
  '/auth/verify-email?token=accessibility-check',
];

for (const path of PAGES) {
  test(`${path} has no serious or critical WCAG 2.1 AA violations`, async ({ page }) => {
    await page.goto(path);
    await page.waitForLoadState('networkidle');

    const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();

    // Axe still evaluates every selected WCAG rule. Lower-impact findings are
    // reported as annotations rather than being hidden through rule suppression.
    const blocking = results.violations.filter(
      (v) => v.impact === 'critical' || v.impact === 'serious',
    );
    const advisory = results.violations.filter(
      (v) => v.impact !== 'critical' && v.impact !== 'serious',
    );

    for (const violation of advisory) {
      test.info().annotations.push({
        type: `a11y-${violation.impact ?? 'unknown'}`,
        description: `${violation.id}: ${violation.help} (${violation.nodes.length} node(s))`,
      });
    }

    if (blocking.length > 0) {
      // Name the offending ELEMENTS, not just the rule. The previous message
      // reported "color-contrast (serious) - 2 node(s)" and nothing else, which
      // is not enough to fix anything: the first guess at the culprit
      // (`text-surface-500`) turned out to measure 4.74:1 and pass. axe already
      // knows the selector and the measured ratio — printing them turns a
      // guessing game into a one-line fix.
      const summary = blocking
        .map((v) => {
          const nodes = v.nodes
            .map(
              (n) =>
                `      → ${n.target.join(' ')}\n        ${n.failureSummary?.replace(/\n/g, '\n        ') ?? ''}`,
            )
            .join('\n');
          return `${v.id} (${v.impact}): ${v.help} - ${v.nodes.length} node(s)\n${nodes}`;
        })
        .join('\n  ');
      throw new Error(`${blocking.length} blocking a11y violation(s) on ${path}:\n  ${summary}`);
    }

    await expect(page.locator('main#main-content')).toHaveCount(1);
  });
}

test('pages have a lang attribute on <html>', async ({ page }) => {
  await page.goto('/');
  const lang = await page.getAttribute('html', 'lang');
  expect(lang).toBeTruthy();
});

test('skip link bypasses navigation and enters the page-local main landmark', async ({ page }) => {
  await page.goto('/');

  const skipLink = page.getByRole('link', { name: 'Skip to main content' });
  const main = page.locator('main#main-content');
  await expect(main).toHaveCount(1);
  await expect
    .poll(() =>
      page
        .locator('nav, main#main-content')
        .evaluateAll((elements) => elements.slice(0, 2).map((element) => element.tagName)),
    )
    .toEqual(['NAV', 'MAIN']);

  await page.keyboard.press('Tab');
  await expect(skipLink).toBeFocused();
  await expect(skipLink).toBeInViewport();

  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/#main-content$/);
  await expect(main).toBeFocused();

  await page.keyboard.press('Tab');
  await expect(main.getByRole('link').first()).toBeFocused();
});

test('homepage planner controls have accessible names in both modes', async ({ page }) => {
  await page.goto('/');

  // Developer mode is a preset radiogroup plus two steppers and a switch. It
  // used to be three sliders whose output never changed; the names moved with
  // the controls.
  await expect(page.getByRole('radiogroup', { name: 'Typical day' })).toBeVisible();
  await expect(page.getByRole('radio', { name: 'Typical' })).toBeVisible();

  for (const name of ['Eligible waits per day', 'Units per hour you allow']) {
    await expect(
      page.getByRole('button', { name: `Decrease ${name.toLowerCase()}` }),
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: `Increase ${name.toLowerCase()}` }),
    ).toBeVisible();
  }

  await expect(page.getByRole('switch', { name: 'Quiet hours' })).toBeVisible();

  await page.getByRole('button', { name: 'For advertisers' }).click();
  for (const name of ['Campaign Budget', 'Target CPM', 'Expected Click-Through Rate (CTR)']) {
    await expect(page.getByRole('slider', { name })).toBeVisible();
  }
});

test('homepage planner recomputes instead of showing a fixed sentence', async ({ page }) => {
  await page.goto('/');

  const output = page.getByText('verified signals a day').locator('..');
  const before = await output.innerText();

  // The regression this guards: the previous component's three sliders left the
  // output identical no matter what was moved.
  await page.getByRole('radio', { name: 'Heavy' }).click();
  await expect(output).not.toHaveText(before);

  // The platform's own ceiling must bind, not the visitor's imagination.
  await expect(
    page.getByText(/eligible waits would pass unused|nothing is turned away/),
  ).toBeVisible();
});
