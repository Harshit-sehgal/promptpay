# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: smoke.spec.ts >> Advertiser campaign creation (authenticated) >> renders targeting section with country input
- Location: e2e/smoke.spec.ts:190:7

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator: getByLabel('Country targeting (comma-separated ISO codes)')
Expected: visible
Timeout: 10000ms
Error: element(s) not found

Call log:
  - Expect "toBeVisible" with timeout 10000ms
  - waiting for getByLabel('Country targeting (comma-separated ISO codes)')

```

```yaml
- complementary:
    - text: W WaitLayer
    - navigation:
        - link "Overview":
            - /url: /advertiser
        - link "Campaigns":
            - /url: /advertiser/campaigns
        - link "Create campaign":
            - /url: /advertiser/campaigns/new
        - link "Reports":
            - /url: /advertiser/reports
        - link "Billing":
            - /url: /advertiser/billing
        - link "Settings":
            - /url: /advertiser/settings
- main:
    - heading "Create campaign" [level=1]
    - paragraph: Set up your ad campaign, creative, and targeting in one step
    - heading "Campaign details" [level=2]
    - text: Campaign name
    - textbox "My developer tool campaign"
    - text: Campaign currency
    - combobox:
        - option "USD" [selected]
    - paragraph: Campaigns activate and spend in their own currency — pick a funded deposit balance.
    - text: Bid type
    - combobox:
        - option "CPM" [selected]
        - option "CPC"
    - text: Bid amount (USD)
    - spinbutton: '2.00'
    - text: Total budget (USD)
    - spinbutton: '100.00'
    - paragraph: Minimum $50.00
    - text: Category
    - combobox:
        - option "developer tools" [selected]
        - option "ai ml"
        - option "cloud infra"
        - option "saas"
        - option "education"
        - option "other"
    - text: Landing URL
    - textbox "https://your-product.com"
    - heading "Ad creative" [level=2]
    - text: Headline
    - textbox "Short, attention-grabbing headline"
    - paragraph: 0/50 characters
    - text: Message
    - textbox "Max 80 chars — shown during wait states"
    - paragraph: 0/80 characters
    - text: CTA text
    - textbox "Learn more"
    - text: CTA URL
    - textbox "Defaults to landing URL"
    - paragraph: Preview
    - paragraph: Headline
    - paragraph: Ad message text
    - text: Learn more
    - heading "Targeting" [level=2]
    - text: Country targeting (comma-separated ISO codes)
    - textbox "US, GB, DE (leave empty for all)"
    - paragraph: Empty = worldwide. Use 2-letter ISO codes (US, GB, DE, IN, etc.)
    - button "Create & submit campaign"
- contentinfo:
    - paragraph: © 2026 WaitLayer. All rights reserved.
    - navigation:
        - link "Privacy Policy":
            - /url: /privacy
        - link "GDPR DPA":
            - /url: /legal/gdpr-dpa
        - link "Do Not Sell My Personal Information":
            - /url: /privacy#ccpa
        - link "Feedback":
            - /url: /feedback
        - button "Cookie Settings"
- dialog "Cookie consent":
    - paragraph:
        - text: We use essential cookies to keep you signed in and optional analytics cookies to improve WaitLayer. See our
        - link "Privacy Policy":
            - /url: /privacy
        - text: for details.
    - button "Decline"
    - button "Accept"
- alert "Consent update required":
    - paragraph: Our Privacy Policy and Terms have been updated. Please review and re-accept to keep your account in good standing.
    - button "Review"
    - button "Accept"
- alert
```

# Test source

```ts
  93  |   test('signup page renders with role selection', async ({ page }) => {
  94  |     await page.goto('/auth/signup');
  95  |     await expect(page.locator('h1').first()).toHaveText(/Create your account|Sign up/i);
  96  |     await expect(page.getByText('Developer').first()).toBeVisible();
  97  |     await expect(page.getByText('Advertiser').first()).toBeVisible();
  98  |   });
  99  | });
  100 |
  101 | test.describe('Protected routes redirect when unauthenticated', () => {
  102 |   test('redirects /developer to login when not authenticated', async ({ page }) => {
  103 |     await page.goto('/developer');
  104 |     await page.waitForURL(/\/auth\/login/i, { timeout: 10_000 });
  105 |   });
  106 |
  107 |   test('redirects /advertiser to login when not authenticated', async ({ page }) => {
  108 |     await page.goto('/advertiser');
  109 |     await page.waitForURL(/\/auth\/login/i, { timeout: 10_000 });
  110 |   });
  111 | });
  112 |
  113 | // ── Developer dashboard E2E (requires authenticated session) ──
  114 | test.describe('Developer dashboard (authenticated)', () => {
  115 |   test.beforeAll(async () => {
  116 |     await createTestUser(developerUser);
  117 |   });
  118 |
  119 |   test.afterAll(async () => {
  120 |     await deleteTestUser(developerUser);
  121 |   });
  122 |
  123 |   test.beforeEach(async ({ page }) => {
  124 |     await loginAs(page, developerUser);
  125 |   });
  126 |
  127 |   test('renders the developer dashboard with earnings cards', async ({ page }) => {
  128 |     await page.goto('/developer');
  129 |     await expect(page.locator('h1').first()).toBeVisible({ timeout: 15_000 });
  130 |     await expect(page.getByText('Estimated today').first()).toBeVisible();
  131 |     await expect(page.getByText('Available payout').first()).toBeVisible();
  132 |     await expect(page.getByText('Confirmed').first()).toBeVisible();
  133 |     await expect(page.getByText('Lifetime').first()).toBeVisible();
  134 |   });
  135 |
  136 |   test('renders the trust and payout status section', async ({ page }) => {
  137 |     await page.goto('/developer');
  138 |     await expect(page.getByText('Trust & Payout Status').first()).toBeVisible({ timeout: 15_000 });
  139 |     await expect(page.getByText('Revenue Split').first()).toBeVisible();
  140 |     await expect(page.getByText('60%').first()).toBeVisible();
  141 |   });
  142 |
  143 |   test('developer settings page renders', async ({ page }) => {
  144 |     await page.goto('/developer/settings');
  145 |     await expect(page.locator('h1').first()).toBeVisible({ timeout: 15_000 });
  146 |   });
  147 |
  148 |   test('developer earnings page renders', async ({ page }) => {
  149 |     await page.goto('/developer/earnings');
  150 |     await expect(page.locator('h1').first()).toBeVisible({ timeout: 15_000 });
  151 |   });
  152 |
  153 |   test('developer payouts page renders', async ({ page }) => {
  154 |     await page.goto('/developer/payouts');
  155 |     await expect(page.locator('h1').first()).toBeVisible({ timeout: 15_000 });
  156 |   });
  157 | });
  158 |
  159 | // ── Advertiser campaign creation E2E (requires authenticated session) ──
  160 | test.describe('Advertiser campaign creation (authenticated)', () => {
  161 |   test.beforeAll(async () => {
  162 |     await createTestUser(advertiserUser);
  163 |   });
  164 |
  165 |   test.afterAll(async () => {
  166 |     await deleteTestUser(advertiserUser);
  167 |   });
  168 |
  169 |   test.beforeEach(async ({ page }) => {
  170 |     await loginAs(page, advertiserUser);
  171 |   });
  172 |
  173 |   test('renders the new campaign form with all required fields', async ({ page }) => {
  174 |     await page.goto('/advertiser/campaigns/new');
  175 |     await expect(page.locator('h1').first()).toHaveText('Create campaign');
  176 |     // Labels are now associated via htmlFor; inputs have stable data-testid attrs
  177 |     await expect(page.getByLabel('Campaign name')).toBeVisible();
  178 |     await expect(page.getByLabel('Bid type')).toBeVisible();
  179 |     await expect(page.getByTestId('campaign-bid-amount-input')).toBeVisible();
  180 |     await expect(page.getByTestId('campaign-budget-input')).toBeVisible();
  181 |   });
  182 |
  183 |   test('shows ad creative section with headline and message inputs', async ({ page }) => {
  184 |     await page.goto('/advertiser/campaigns/new');
  185 |     await expect(page.getByText('Ad creative').first()).toBeVisible();
  186 |     await expect(page.getByLabel('Headline')).toBeVisible();
  187 |     await expect(page.getByLabel('Message')).toBeVisible();
  188 |   });
  189 |
  190 |   test('renders targeting section with country input', async ({ page }) => {
  191 |     await page.goto('/advertiser/campaigns/new');
  192 |     await expect(page.getByText('Targeting').first()).toBeVisible();
> 193 |     await expect(page.getByLabel('Country targeting (comma-separated ISO codes)')).toBeVisible();
      |                                                                                    ^ Error: expect(locator).toBeVisible() failed
  194 |   });
  195 |
  196 |   test('submit button is present', async ({ page }) => {
  197 |     await page.goto('/advertiser/campaigns/new');
  198 |     await expect(page.locator('button[type="submit"]').first()).toBeVisible({ timeout: 15_000 });
  199 |   });
  200 |
  201 |   test('advertiser dashboard renders with campaign list or empty state', async ({ page }) => {
  202 |     await page.goto('/advertiser');
  203 |     await expect(page.locator('h1').first()).toBeVisible({ timeout: 15_000 });
  204 |   });
  205 | });
  206 |
```
