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
 */

const PAGES = [
  '/',
  '/pricing',
  '/privacy',
  '/terms',
  '/comparison',
  '/contact',
  '/feedback',
  '/security',
  '/status',
  '/auth/login',
  '/auth/signup',
  '/auth/forgot-password',
  '/auth/reset-password?token=accessibility-check',
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
      const summary = blocking
        .map((v) => `${v.id} (${v.impact}): ${v.help} - ${v.nodes.length} node(s)`)
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

test('homepage calculator sliders have accessible names in both modes', async ({ page }) => {
  await page.goto('/');

  for (const name of ['Daily AI Queries', 'Ad Display Frequency', 'Average Campaign CPM']) {
    await expect(page.getByRole('slider', { name })).toBeVisible();
  }

  await page.getByRole('button', { name: 'For Advertisers' }).click();
  for (const name of ['Campaign Budget', 'Target CPM', 'Expected Click-Through Rate (CTR)']) {
    await expect(page.getByRole('slider', { name })).toBeVisible();
  }
});
