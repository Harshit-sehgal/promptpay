# Homepage Redesign (PR 1: tokens, type, homepage, public pages) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship "the counter" homepage, the six visitor palettes, the new type and the glass public chrome across every public and auth page.

**Architecture:** A single palette module (`src/lib/palette.ts`) is the source of truth for palette ids and values. A pre-paint script sets `html[data-palette]` and, for Midnight, the existing `.dark` class. `globals.css` holds one token layer keyed on `data-palette`; the existing `--public-*` / `--app-*` variables are re-pointed at it, so public pages restyle without markup rewrites. The homepage is a server page composed of small client islands: clock, picker, reveal and colour fields.

**Tech Stack:** Next.js 16 (App Router, webpack), React 19, Tailwind 4, `next/font/local`, Vitest + Testing Library (jsdom), Playwright + axe.

**Spec:** [`docs/superpowers/specs/2026-10-24-homepage-redesign-design.md`](../specs/2026-10-24-homepage-redesign-design.md). The mockup [`2026-10-24-homepage-redesign-mockup.html`](../specs/2026-10-24-homepage-redesign-mockup.html) is the source of truth for exact CSS values, motion curves and copy. Executors read all three.

**Out of scope (PR 2, separate plan):** dashboard (`.app-shell`, `Sidebar`, developer/advertiser/admin) restyle to the new tokens. Fixing inaccurate claims on `/comparison`.

## Global Constraints

- Work on branch `feat/homepage-counter` from `main`. Never commit to `main`.
- All paths below are relative to `apps/web/` unless they start with `docs/` or `scripts/`.
- Fonts are self-hosted through `next/font/local`. No `@import url(` and no Google Fonts link anywhere.
- Display: Inter Tight 800, letter-spacing about -0.045em, word-spacing .04–.05em. UI: Geist 400–600. Utility: Geist Mono 400–500, `font-variant-numeric: tabular-nums` on timers.
- Palette storage key: `ateva-palette`. Legacy key: `ateva-landing-theme`. Default: `warm`; `midnight` when `prefers-color-scheme: dark`.
- Glass: `rgb(255 255 255 / .52)` fill, 1px `rgb(255 255 255 / .85)` edge, inset top highlight, `backdrop-filter: blur(22px) saturate(1.4)`. Fallback without support: `rgb(255 255 255 / .72)`. Midnight: fill `.07`, edge `.16`.
- Radii: 16px objects, 22px panels, 28px closing panel, pills fully round.
- Copy is final as written in the spec. "Tidewater CI" stays labelled as an example sponsor.
- Must not appear in new copy: earnings, payouts, revenue share, "0+" counters, Anthropic affiliation, `#2b3cff`, serif display type, uppercase mono eyebrows, numbered steps.
- `prefers-reduced-motion: reduce` shows every element in its final state. The timers still tick.
- Every public route in `e2e/a11y.spec.ts` must pass axe WCAG 2.1 AA (serious and critical) on desktop and Pixel 5.
- `pnpm test:release-gates` (repo root) must pass, including `scripts/public-payment-claims.test.mjs`.

## Review Focus

1. **Storage blocked or throwing** (private mode, blocked site data). The bootstrap and picker must not throw. The picker still recolours for the visit. Covered in Task 2 (`resolvePalette` with throwing storage) and Task 4 (picker with throwing `setItem`).
2. **Garbage in storage.** `ateva-palette = "neon"` or legacy `"system"` must fall back to the default and never set an unknown `data-palette`. Covered in Task 2.
3. **Hidden tab and long sessions.** The clock must not drift or run up a backlog when the tab is hidden for minutes, and must never show past `0:12`. Covered in Task 6 (`clockFrame` modular test and a `visibilitychange` test).
4. **Quiet text on glass in every palette**, Midnight included. This is where axe usually fails. Covered in Task 3 (contrast unit test over all six palettes) and Task 9 (axe on `/` per palette).
5. **Signed-in visitor on `/`.** Both CTAs must read "Open dashboard" and point to the role's dashboard, and the nav must hide Log in. Covered in Task 6 (`HomeAction` test with a mocked `useAuth`).

---

### Task 1: Branch, fonts and type tokens

**Files:**

- Create: `public/fonts/inter-tight-var.ttf`, `public/fonts/geist-var.ttf`, `public/fonts/geist-mono-var.ttf`
- Delete: `public/fonts/instrument-serif-400.ttf`, `public/fonts/instrument-serif-400-italic.ttf`, `public/fonts/inter-*.ttf`, `public/fonts/jetbrains-mono-*.ttf`
- Modify: `src/app/layout.tsx:13-41,100-104`, `tailwind.config.ts` (`fontFamily`), `src/app/globals.css` (`--font-display`, `--font-ui`, `--font-utility` in the shared `:root` block at about line 80), `src/app/opengraph-image.tsx`
- Modify: `src/__tests__/globals-css-integrity.test.ts`
- Create: `public/fonts/README.md` (font sources and pinned SHAs)

**Interfaces:**

- Produces: CSS variables `--font-display` (Inter Tight), `--font-ui` (Geist), `--font-utility` (Geist Mono). Tailwind `font-sans` maps to Geist, `font-mono` to Geist Mono, and `font-serif` to Inter Tight. Keeping the `font-serif` key means existing public-page headings switch face without markup edits.

- [ ] **Step 1:** `git checkout -b feat/homepage-counter`.
- [ ] **Step 2: Get the fonts.** These are OFL variable fonts from `github.com/google/fonts`: `ofl/intertight/InterTight[wght].ttf`, `ofl/geist/Geist[wght].ttf` and `ofl/geistmono/GeistMono[wght].ttf`. Pin them to a commit SHA. Ask the user before downloading. Save them under the names above and add the `OFL.txt` license next to them as `public/fonts/OFL-<family>.txt`. Write `public/fonts/README.md` listing the source URL and SHA for each.
- [ ] **Step 3: Write the failing integrity test.** Replace the `has the serif wired…` case with:

```ts
it('wires the three self-hosted families used by the design system', () => {
  const layout = readFileSync(join(__dirname, '..', 'app', 'layout.tsx'), 'utf8');
  for (const file of ['inter-tight-var.ttf', 'geist-var.ttf', 'geist-mono-var.ttf']) {
    expect(layout).toContain(file);
  }
  for (const v of ['--font-display', '--font-ui', '--font-utility']) {
    expect(layout).toContain(v);
  }
  expect(layout).not.toMatch(/instrument-serif|jetbrains-mono/);
});
```

- [ ] **Step 4:** Run `pnpm --filter ateva-web test -- globals-css-integrity`. Expected: FAIL on the new case.
- [ ] **Step 5: Implement.** In `layout.tsx`, use three `localFont` calls, each `{ path, weight: '100 900', style: 'normal' }`, with `variable` set to `--font-display` / `--font-ui` / `--font-utility`. Delete the three `--font-*` redefinitions in the shared `:root` block of `globals.css` so nothing shadows the next/font variables. Point Tailwind `sans` / `mono` / `serif` at those variables. In `opengraph-image.tsx`, load `inter-tight-var.ttf`, set `fontFamily: 'Inter Tight'` and weight 800, and set the headline to "Your agent has been working for 0:05.".
- [ ] **Step 6:** Run `pnpm --filter ateva-web test && pnpm --filter ateva-web typecheck`. Expected: PASS. Also grep: `grep -rn "Instrument Serif\|JetBrains" src` returns nothing.
- [ ] **Step 7: Commit** with the message `feat(web): self-host Inter Tight, Geist and Geist Mono as the type system`.

### Task 2: Palette module and pre-paint bootstrap

**Files:**

- Create: `src/lib/palette.ts`, `src/lib/palette.test.ts`
- Modify: `src/app/layout.tsx` (replace `themeBootstrapScript` with `paletteBootstrapScript`)

**Interfaces:**

- Produces:
  - `type PaletteId = 'warm' | 'sunset' | 'mint' | 'lavender' | 'citrus' | 'midnight'`
  - `PALETTES: readonly { id: PaletteId; label: string; page: string; c: [string, string, string, string]; fieldOpacity: number; ink: string; copy: string; quiet: string; glass: string }[]`, holding the spec's palette table values verbatim. Light palettes use ink `#111111`, copy `#55554f`, quiet `#8a8a84`, glass `rgb(255 255 255 / .52)`. Midnight uses `#f4f3ef` / `#b4b4bb` / `#85858d` / `rgb(255 255 255 / .07)`. `glass` is parsed by Task 3's contrast test.
  - `PALETTE_STORAGE_KEY = 'ateva-palette'`, `LEGACY_THEME_KEY = 'ateva-landing-theme'`
  - `isPaletteId(v: unknown): v is PaletteId`
  - `resolvePalette(storage: Pick<Storage,'getItem'|'setItem'|'removeItem'> | null, prefersDark: boolean): { id: PaletteId; chosen: boolean }`. `chosen` is false when the result is only the system default. This function performs the one-time legacy migration.
  - `applyPalette(id: PaletteId, root?: HTMLElement): void` sets `root.dataset.palette = id` and toggles `.dark` exactly when `id === 'midnight'`.
  - `paletteBootstrapScript: string`, an IIFE that inlines the same logic as `resolvePalette` + `applyPalette` with no imports. It also keeps today's `data-landing-motion='enabled'` behaviour, renamed to `data-motion`.

- [ ] **Step 1: Write the failing tests** in `palette.test.ts`:
  - `resolvePalette(null, false)` returns `{ id: 'warm', chosen: false }`, and `resolvePalette(null, true)` returns `{ id: 'midnight', chosen: false }`.
  - A stored `'mint'` returns `{ id: 'mint', chosen: true }`.
  - A stored `'neon'` with `prefersDark` false returns `warm`, `chosen: false`.
  - New key unset, legacy `'dark'`: the result is `{ id: 'midnight', chosen: true }`. After the call `getItem('ateva-palette') === 'midnight'` and `getItem('ateva-landing-theme') === null`.
  - New key unset, legacy `'light'`: returns the system default, and the legacy key is left untouched.
  - New key `'citrus'` and legacy `'dark'`: returns `citrus`, and the legacy key is left alone.
  - Storage whose `getItem` throws: `resolvePalette` does not throw and returns the system default.
  - `applyPalette('midnight', el)` gives `el.dataset.palette === 'midnight'` and `el.classList.contains('dark')`. `applyPalette('warm', el)` removes `.dark`.
  - Bootstrap parity: evaluate `paletteBootstrapScript` with `new Function` against a jsdom `document` and a stubbed `localStorage` / `matchMedia`, once for each case above. Assert that `document.documentElement.dataset.palette` equals what `resolvePalette` returns.
  - Every `PALETTES` entry has a unique `id`, and the ids are exactly the six in spec order.
- [ ] **Step 2:** Run `pnpm --filter ateva-web test -- palette`. Expected: FAIL (module missing).
- [ ] **Step 3: Implement** `src/lib/palette.ts` from the interfaces above. Delete `themeBootstrapScript` from `layout.tsx` and render `paletteBootstrapScript` in the same `<Script strategy="beforeInteractive">`.
- [ ] **Step 4:** Run `pnpm --filter ateva-web test -- palette`. Expected: PASS.
- [ ] **Step 5: Commit** with the message `feat(web): palette module with pre-paint bootstrap and legacy dark migration`.

### Task 3: One token layer in `globals.css`

**Files:**

- Modify: `src/app/globals.css`. Replace the `html:is(.dark, [data-landing-theme='dark'])` token block (about lines 120–145) and add the palette blocks next to the shared `:root` (about line 80).
- Create: `src/lib/contrast.test.ts`
- Modify: `src/__tests__/globals-css-integrity.test.ts`

**Interfaces:**

- Consumes: `PALETTES` from Task 2.
- Produces: CSS custom properties on `html[data-palette=<id>]`:
  - `--page`, `--c1`…`--c4`, `--orb-op`;
  - `--ink`, `--copy`, `--quiet`;
  - `--glass`, `--glass-edge`, `--glass-strong` (the fallback), `--solid`;
  - `--on-ink`, `--dash`, `--ok`, `--struck`;
  - `--mini-bg`.

  The names and values match the mockup's CSS. `warm` values also live on `:root`, so a missing attribute still renders Warm. `--public-canvas`, `--public-surface`, `--public-ink`, `--public-copy`, `--public-muted` and `--public-line` are re-pointed at these. `--app-*` stays as today, still driven by `.dark`, until PR 2.

- [ ] **Step 1: Write the failing tests.**
  - `contrast.test.ts` (Review Focus 4): add a `relativeLuminance` / `contrastRatio` helper in the test file (WCAG 2.1 formula). For each palette, composite `glass` over `page` with alpha blending. Assert `contrastRatio(copy, page) >= 4.5`, `contrastRatio(copy, glassOnPage) >= 4.5` and `contrastRatio(quiet, glassOnPage) >= 4.5`. For the timer chip, assert `contrastRatio(page, ink) >= 4.5`, since the chip is ink with page-coloured text. If `quiet` fails for a palette, darken that palette's `quiet` in `palette.ts` (and the CSS) until it passes. Note the change in the commit message.
  - In the integrity test, assert that each `PALETTES[i].page` hex and `--c1` value appears in `css` inside an `html[data-palette='<id>']` block.
  - Also assert `html[data-palette='midnight']` sets `color-scheme: dark`.
- [ ] **Step 2:** Run `pnpm --filter ateva-web test -- contrast globals-css-integrity`. Expected: FAIL.
- [ ] **Step 3: Implement** the token blocks, copying values from the mockup's `:root` and `html[data-theme=…]` rules, renamed to `data-palette`. Add `body { transition: background-color .6s, color .6s }` inside `@media (prefers-reduced-motion: no-preference)`. Add `@supports not (backdrop-filter: blur(1px)) { --glass: var(--glass-strong) }`.
- [ ] **Step 4:** Run the same command. Expected: PASS.
- [ ] **Step 5: Commit** with the message `feat(web): single palette token layer driving public surfaces`.

### Task 4: Palette picker

**Files:**

- Create: `src/components/palette-picker.tsx`, `src/components/palette-picker.test.tsx`
- Modify: `src/app/globals.css` (add `.palette-picker*` rules from the mockup's `.picker` / `.menu` CSS)

**Interfaces:**

- Consumes: `PALETTES`, `resolvePalette`, `applyPalette`, `PALETTE_STORAGE_KEY` (Task 2).
- Produces: `export function PalettePicker(): JSX.Element`, a client component with no props.

- [ ] **Step 1: Write the failing tests** (jsdom). Stub `matchMedia` with a controllable `change` listener.
  - The trigger is a button with accessible name "Background: Warm" and `aria-expanded="false"`. Clicking it shows a `radiogroup` named "Background" with six `radio`s, and Warm has `aria-checked="true"`.
  - Clicking "Mint" sets `document.documentElement.dataset.palette` to `'mint'`, sets `localStorage['ateva-palette']` to `'mint'`, and marks Mint `aria-checked`.
  - With focus on a radio, `ArrowRight` applies the next palette and moves focus to it. `ArrowLeft` from the first option wraps to the last.
  - `Escape` closes the menu and returns focus to the trigger. A `mousedown` on `document.body` closes it.
  - Before any pick, firing the `matchMedia` change with `matches: true` applies `midnight`. After a pick, the change is ignored.
  - Review Focus 1: with `localStorage.setItem` throwing, clicking "Citrus" still sets `dataset.palette` to `'citrus'` and nothing throws.
  - The first render is deterministic (trigger label "Background"). The effect then syncs it from `document.documentElement.dataset.palette`. This mirrors today's `ThemeToggle` hydration approach.
- [ ] **Step 2:** Run `pnpm --filter ateva-web test -- palette-picker`. Expected: FAIL.
- [ ] **Step 3: Implement.** Roving `tabIndex` on the radios. The menu is `position: absolute`, and pinned `left/right: 16px` under 640px as in the mockup. The trigger swatch is a conic gradient of the current palette's `c` values.
- [ ] **Step 4:** Run the tests again. Expected: PASS.
- [ ] **Step 5: Commit** with the message `feat(web): background palette picker`.

### Task 5: Motion primitives: reveal and colour fields

**Files:**

- Create: `src/components/motion/reveal.tsx`, `src/components/motion/color-fields.tsx`, `src/components/motion/motion.test.tsx`
- Modify: `src/app/globals.css` (`.reveal`, `.reveal.is-in`, `.color-fields`, `.color-field` rules from the mockup's `.rv` / `.orbs` CSS)

**Interfaces:**

- Produces:
  - `Reveal({ as?: 'div'|'p'|'h2'|'section'; delayIndex?: number; className?: string; children })`. It renders with class `reveal`, sets `style={{ '--i': delayIndex }}` for the 70ms stagger (`transition-delay: calc(var(--i) * 70ms)`), and adds `is-in` once on first intersection (threshold 0.15), then disconnects.
  - `ColorFields({ fields: { color: 1|2|3|4; size: number; x: string; y: string; speed: number }[] })`. It renders `aria-hidden` blurred circles, using `var(--c<color>)` for colour and `var(--orb-op)` for opacity, and one shared passive scroll listener with rAF that sets `translate3d(0, scrollY*speed, 0)` on each field.
  - Both components do nothing under reduced motion. Reveal renders `is-in` immediately and ColorFields never attaches the scroll listener.

- [ ] **Step 1: Write the failing tests.** Mock `IntersectionObserver` and `matchMedia('(prefers-reduced-motion: reduce)')`.
  - A Reveal lacks `is-in` until the observer reports `isIntersecting`, then has it. It keeps it after a later non-intersecting report.
  - Under reduced motion, a Reveal has `is-in` on mount and creates no observer.
  - Under reduced motion, ColorFields calls `addEventListener('scroll', …)` zero times.
  - All fields carry `aria-hidden="true"`.
- [ ] **Step 2:** Run `pnpm --filter ateva-web test -- motion`. Expected: FAIL.
- [ ] **Step 3: Implement.** Gate the CSS hidden state on `html[data-motion='enabled'] .reveal:not(.is-in) { opacity: 0; transform: translateY(28px) }`. Without JS or with reduced motion, content stays visible. `.color-fields` must not clip (no `overflow: hidden`). `body` already has `overflow-x: clip`; keep it.
- [ ] **Step 4:** Run the tests again. Expected: PASS.
- [ ] **Step 5: Commit** with the message `feat(web): reveal and parallax colour-field primitives`.

### Task 6: Homepage sections and clock

**Files:**

- Create in `src/components/home/`: `clock.ts` (pure), `clock.test.ts`, `hero.tsx`, `wait-timeline.tsx`, `privacy-ledger.tsx`, `sponsors-section.tsx`, `close-section.tsx`, `home-action.tsx`, `home-action.test.tsx`, `hero.test.tsx`
- Modify: `src/app/page.tsx` (full rewrite as a server component composing the sections)
- Delete: `src/components/beta-signal-planner.tsx`, `src/components/landing-product-showcase.tsx`, and their exports from `src/components/index.ts`
- Modify: `e2e/a11y.spec.ts` (delete the two `homepage planner …` tests), `e2e/smoke.spec.ts` if the hero test no longer holds
- Modify: `src/app/globals.css` (homepage section rules, translated from the mockup)

**Interfaces:**

- Consumes: `Reveal`, `ColorFields` (Task 5). `useAuth` from `@/lib/auth-context`, `getDashboardPath` from `@/lib/auth-routing`.
- Produces:
  - `clock.ts`:
    - `CLOCK_PERIOD = 16`, `SSR_HERO_SECOND = 5`, `SSR_CLOSE_SECOND = 7`.
    - `clockFrame(tick: number): { label: string; status: string; done: boolean; cardVisible: boolean }`. `s = ((tick % 16) + 16) % 16`; `shown = min(s, 12)`; `label = '0:' + pad2(shown)`; `done = s >= 12`; `cardVisible = s >= 1 && s <= 11`. `status` is `'✓ Done. 3 files changed.'` when done, otherwise `['Working', 'Reading 14 files', 'Running tests', 'Writing a fix'][floor(s/3) % 4] + '…'`.
  - `useClock(startAt: number): number`, a hook in `hero.tsx`. It returns the tick and starts at `startAt`. After mount it advances once per second with `setInterval`. On `visibilitychange` it pauses while hidden and resumes from the same tick, with no catch-up.
  - `HomeAction({ placement: 'hero' | 'close' })`, a client component. Signed out, it renders "Join the beta" linking to `/auth/signup?role=developer`. Signed in, it renders "Open dashboard" linking to `getDashboardPath(user.role)`. The hero placement adds the quiet "Free · private beta · VS Code" text when signed out.
  - Section ids: `how-it-works` (wait timeline), `privacy` (ledger), `sponsors`, `get-started` (close).

- [ ] **Step 1: Write the failing tests.**
  - `clock.test.ts` (Review Focus 3): `clockFrame(0)` returns `{label:'0:00', cardVisible:false, done:false, status:'Working…'}`. `clockFrame(1).cardVisible` and `clockFrame(11).cardVisible` are true. `clockFrame(12)` has `label: '0:12'` and `done: true`. `clockFrame(15).label === '0:12'`. `clockFrame(16)` deep-equals `clockFrame(0)`. `clockFrame(16 * 1000 + 5)` deep-equals `clockFrame(5)`. For every `t` in 0..200, `label <= '0:12'`.
  - `hero.test.tsx`: on server render (`renderToString`), the hero contains `0:05` and the sponsor card has the visible class. After mount plus `vi.advanceTimersByTime(1000)` it shows `0:06`. With `document.visibilityState = 'hidden'` dispatched, advancing 60s leaves the label unchanged. Making the tab visible again and advancing 1000ms shows the next second.
  - `home-action.test.tsx` (Review Focus 5): mock `useAuth`. Signed out, the link is named "Join the beta" with href `/auth/signup?role=developer`. Signed in as `advertiser`, the link is named "Open dashboard" with href `getDashboardPath('advertiser')`.
- [ ] **Step 2:** Run `pnpm --filter ateva-web test -- home`. Expected: FAIL.
- [ ] **Step 3: Implement the sections** with the spec's copy verbatim. Notes:
  - The timer chip is a `<span>` inside the `<h1>`. Give it `aria-hidden="true"` and add a visually hidden static "a few seconds" in its place for screen readers. Otherwise a live heading re-announces every second. Mark this as the builder's call in the PR description.
  - The status line is `aria-live="off"`.
  - Privacy ledger:
    - "Sent to Ateva" has six items, in the spec's order.
    - "Never sent" has four items, each with a `<span class="strike">` that draws when the panel's Reveal is in. Use `transition-delay: calc(var(--j) * 110ms)` and 0.45s.
    - The quiet line under the panels reads "Full detail, including consent and request IDs, is in the privacy policy." and links to `/privacy`.
  - Close: render the fine-print line exactly as in the spec, inside the close section and above the global footer.
  - The headline word rise on load is CSS only (`.hero-word` with `--w` index, 40ms apart), gated on `html[data-motion='enabled']`.
  - `page.tsx` becomes a server component. Its wrapper has class `home-page` (Task 9 keys on it), and it keeps `<main id="main-content" tabIndex={-1}>`.
  - Hero card entrance: opacity + `translateY(10px)` over 0.28s `cubic-bezier(.2,.8,.2,1)`. The agent dot pulses at 1.2s and turns `var(--ok)` when done.
  - Only `HomeAction`, the hero clock and `SiteHeader` are client components.
- [ ] **Step 4:** Run `pnpm --filter ateva-web test && pnpm --filter ateva-web typecheck && pnpm --filter ateva-web lint`. Expected: PASS.
- [ ] **Step 5: Commit** with the message `feat(web): the counter homepage`.

### Task 7: Site header and auth chrome

**Files:**

- Modify: `src/components/site-header.tsx` (rewrite markup; keep its props API)
- Create: `src/components/site-header.test.tsx`
- Modify: `src/components/auth-shell.tsx:61` (`ThemeToggle` becomes `PalettePicker`)
- Modify: `src/components/theme-toggle.tsx` and `theme-toggle.test.tsx`. This toggle stays only in `Sidebar` (the dashboards). It now writes `ateva-palette` (`warm` ↔ `midnight`) through `applyPalette`, so dashboards and public pages share one setting.
- Modify: `src/app/globals.css` (`.site-header*` rules: inset 12px sticky, transparent until scrolled, then a glass pill)
- Modify: `src/__tests__/globals-css-integrity.test.ts` (keep the `aria-label="Primary navigation"` and `backdrop-blur-xl` assertions; the header keeps that class)

**Interfaces:**

- Consumes: `PalettePicker` (Task 4), `applyPalette`, `PALETTE_STORAGE_KEY` (Task 2).
- Produces:
  - `NAV_ITEMS = [{label:'How it works', href:'/#how-it-works'}, {label:'Privacy', href:'/#privacy'}, {label:'Sponsors', href:'/#sponsors'}]`.
  - The header sets `data-scrolled` when `scrollY > 24`.
  - Defaults: `showThemeToggle` renamed to `showPalettePicker` (default true). `primaryLabel` defaults to "Join beta" on `/`.

- [ ] **Step 1: Write the failing tests.**
  - `site-header.test.tsx`: it renders links "How it works", "Privacy" and "Sponsors" with the hrefs above, a button named /^Background/, and "Log in" when `showLogin`. With `showLogin={false}`, there is no "Log in". Firing `scroll` with `scrollY = 30` sets `data-scrolled` on the header.
  - `theme-toggle.test.tsx`: clicking "Switch to dark mode" sets `localStorage['ateva-palette']` to `'midnight'`, `dataset.palette` to `'midnight'` and the `.dark` class. Clicking again sets `'warm'` and removes `.dark`.
- [ ] **Step 2:** Run `pnpm --filter ateva-web test -- site-header theme-toggle`. Expected: FAIL.
- [ ] **Step 3: Implement.** Below 860px, the header keeps only the wordmark, the picker and the CTA. The text links hide, and the mobile menu button and `#public-mobile-navigation` are removed (spec: narrow screens show three controls). Update the `smoke.spec.ts` hero test: change its 768 breakpoint check to 860. Update every `SiteHeader` caller that passes `showThemeToggle` (grep `showThemeToggle`).
- [ ] **Step 4:** Run `pnpm --filter ateva-web test && pnpm --filter ateva-web typecheck`. Expected: PASS.
- [ ] **Step 5: Commit** with the message `feat(web): glass public header with palette picker`.

### Task 8: Footer restyle and anchors

**Files:**

- Modify: `src/components/site-footer.tsx`. `PRODUCT_LINKS` becomes `How it works /#how-it-works`, `Privacy /#privacy`, `Sponsors /#sponsors`, `Pricing /pricing`, `Comparison /comparison`. Delete `Product`, `Developers` and `Trust`. Keep every `RESOURCE_LINKS` and `COMPANY_LINKS` entry and the cookie-settings button unchanged. Replace the serif "The wait becomes visible." lead with the wordmark plus the existing one-line description.
- Modify: `e2e/public-content.spec.ts` (add the anchor test)
- Modify: `src/app/globals.css` (`.site-footer` rules on the new tokens)

**Interfaces:**

- Consumes: section ids from Task 6 and `NAV_ITEMS` from Task 7.

- [ ] **Step 1: Write the failing e2e test** `homepage anchors used by header and footer all resolve`. On `/`, collect every `a[href^="/#"]` in `header` and `footer`. For each, assert `page.locator('#' + id)` has count 1.
- [ ] **Step 2:** Run `pnpm --filter ateva-web e2e -- public-content -g anchors` with the dev server on. Expected: FAIL on `#product`.
- [ ] **Step 3: Implement** the link changes and the styles.
- [ ] **Step 4:** Run the test again. The existing `footer links to …` legal tests must also pass. Expected: PASS.
- [ ] **Step 5: Commit** with the message `feat(web): restyle footer and point anchors at the new sections`.

### Task 9: Public and auth pages adopt the system

**Files:**

- Modify: `src/components/site-header.tsx`. Render one fixed `<ColorFields>` backdrop (three fields, low speed) when `pathname !== '/'`. The homepage places its own fields per section.
- Modify: `src/components/auth-shell.tsx`. Use the same backdrop. The frame becomes a glass panel and the dark aside uses `--solid`.
- Modify: `src/app/globals.css`, in the `body:has(.site-header):not(:has(.landing-page)) main …` remap block (about lines 236–290). Rename the `:not(:has(.landing-page))` guard to `:not(:has(.home-page))`. Map `bg-white` / `bg-surface-50` surfaces to `var(--glass)` with the glass edge and blur. Give `main .font-serif` weight 800, letter-spacing -0.045em and word-spacing .04em.
- Modify: `e2e/a11y.spec.ts` (add the per-palette test)

**Interfaces:**

- Consumes: `ColorFields` (Task 5), tokens (Task 3), `PALETTES` ids (Task 2).

- [ ] **Step 1: Write the failing e2e test** (Review Focus 4): `every palette passes axe on the homepage and a legal page`. For each of the six ids and each of `'/'` and `'/legal/data-retention'`:
  - `page.addInitScript` sets `localStorage['ateva-palette']`;
  - goto the page;
  - run the same blocking-violation check the per-route test uses.

  Extract that check into a local `assertNoBlockingViolations(page, label)` function and reuse it in both tests.

- [ ] **Step 2:** Run `pnpm --filter ateva-web e2e -- a11y`. Expected: FAIL. Midnight or quiet-on-glass is the likely failure until the remap lands.
- [ ] **Step 3: Implement** the remap and the backdrops. Do not change page content or structure.
- [ ] **Step 4:** Run `pnpm --filter ateva-web e2e -- a11y public-content smoke`. Expected: PASS on `chromium` and `mobile-chromium`.
- [ ] **Step 5: Commit** with the message `feat(web): public and auth pages on the palette system`.

### Task 10: Retire dead CSS and final verification

**Files:**

- Modify: `src/app/globals.css`. Delete every rule whose selector contains `landing-` or `data-landing-theme`, and the `.theme-toggle` rules under `.site-header` / `.auth-shell` (the sidebar ones stay). `.app-shell` rules that reference `data-landing-theme` keep only their `.dark` half.
- Modify: `src/__tests__/globals-css-integrity.test.ts`. Delete `keeps dark-mode planner values readable…`. Add `no landing-era selectors remain`: `expect(css).not.toMatch(/\.landing-|data-landing-theme/)`.
- Modify: `AGENTS.md`, the section describing the 2026-08-26 editorial design, to describe the new system in its existing style.

- [ ] **Step 1:** Add the new integrity case. Run it. Expected: FAIL.
- [ ] **Step 2:** Delete the rules. Then `grep -rn "landing-" src --include=*.tsx` must return only `campaign-landing-url` in `src/app/advertiser/campaigns/new/page.tsx`.
- [ ] **Step 3:** Run all of the following:
  - `pnpm --filter ateva-web test && pnpm --filter ateva-web typecheck && pnpm --filter ateva-web lint && pnpm --filter ateva-web build`
  - `pnpm test:release-gates` from the repo root
  - `pnpm --filter ateva-web e2e`

  Expected: all PASS. Report `wc -l src/app/globals.css` before and after.

- [ ] **Step 4: Visual check.** In the browser pane at 1400×900 and the mobile preset, check `/` in all six palettes, plus `/pricing`, `/legal/data-retention` and `/auth/login` in Warm and Midnight. Check:
  - no horizontal scroll (`document.documentElement.scrollWidth <= innerWidth`);
  - the card appears at 0:01;
  - the palette persists across reload with no flash;
  - with reduced motion emulated, everything is visible.

  Compare against the mockup and fix drift.

- [ ] **Step 5: Commit** with the message `chore(web): retire landing-era CSS and planner guards`. Then ask the user before pushing or opening the PR.

---

## Calls made in this plan (for the user to check)

- **Fonts change sitewide in PR 1**, dashboards included, because fonts load in the root layout. Dashboard colours wait for PR 2.
- **One shared setting.** The dashboards' light/dark toggle now writes the palette key (Warm ↔ Midnight), so the legacy-key migration can't silently reset a dashboard user's dark mode.
- **`font-serif` stays as a Tailwind key** but now renders Inter Tight 800, so public pages switch type with no markup edits.
- **Hero timer is hidden from screen readers** and replaced with static text, so the heading isn't re-announced every second.
- **No mobile menu.** Narrow screens show only the wordmark, picker and CTA, as the spec says. Log in stays reachable from the signup page.
- **OG image updated** to Inter Tight with "Your agent has been working for 0:05.", not deferred.
