# Counter Redesign PR 2: Dashboards Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the signed-in dashboards onto the counter design's type and colour values, in a plain light/dark version.

**Architecture:** The dashboards already use the shared fonts (`body` uses `--font-ui`). What remains are two old cool-grey colour layers that only the app shell reads:

- `--app-*`, built from the base `--ateva-*` colours;
- `--ateva-refine-*`, with its own light and `html.dark` blocks.

`--app-*` takes fixed Warm values in light mode and fixed Midnight values under `html.dark`. They are fixed literals rather than `var(--page)`, so the dashboards stay plain whichever light palette a visitor picked on the public pages. `--ateva-refine-*` then becomes a single block of references to `--app-*`, and the base `--ateva-*` colours that only fed `--app-*` are deleted.

**Tech Stack:** Next.js 16, Tailwind 4, Vitest/jsdom, Playwright with axe.

**Spec:** `docs/superpowers/specs/2026-10-24-homepage-redesign-design.md`, sections "Rest of the site" and "Rollout in two PRs".

## Global Constraints

- Dashboards get no orbs, no palette picker, and no glass beyond the nav.
- Dark mode keeps the `.dark` class, mapped to Midnight's ink values. `applyPalette` already sets `.dark` exactly when the palette is Midnight.
- Every text token must reach WCAG AA (4.5:1) on canvas, surface and inset, in both modes.
- Dashboard status colours (emerald, amber, rose) keep their current specificity.

## Review Focus

- **Light palettes:** a visitor on Mint or Lavender who opens a dashboard should see plain Warm neutrals, not a mint tint. The literals guarantee this.
- **Refine layer reaches public pages:** the `.public-page main` overrides in the refine layer read `--ateva-refine-*`, so public text colours change slightly. The axe sweep must stay green on every palette.
- **Text selection and focus rings:** these read the refine ink and action tokens, so they must still contrast in both modes.

---

### Task 1: Dashboard token values with a contrast guard

**Files:**

- Create: `apps/web/src/__tests__/dashboard-tokens.test.ts`
- Modify: `apps/web/src/app/globals.css`, in the `:root` `--app-*` block, the `html.dark` block, the refine-layer token blocks and the base `--ateva-*` colours.

- [x] **Step 1:** Write the test. It reads `globals.css` and pulls the `--app-*` hex values from the `:root` block and from the `html.dark` block. For each mode, it asserts a contrast of at least 4.5 for each of `--app-ink`, `--app-copy`, `--app-muted` and `--app-tertiary` on each of `--app-canvas`, `--app-surface` and `--app-nested`. It also asserts that the refine tokens are `var(--app-…)` references.
- [x] **Step 2:** Run `pnpm exec vitest run src/__tests__/dashboard-tokens.test.ts`. It should fail, because the old values carry no `--app-subtle` and the refine tokens are literals.
- [x] **Step 3:** Set the new values.
  - **Light:** canvas `#f4f3ef`, surface `#ffffff`, subtle `#faf9f6`, nested `#ecebe6`, ink `#111111`, copy `#55554f`, muted `#61615b`, tertiary `#686862`. Lines are `rgb(17 17 17 / 0.12)` and `rgb(17 17 17 / 0.2)`.
  - **Dark:** canvas `#0f0f12`, surface `#1c1c21`, subtle `#17171b`, nested `#26262c`, ink `#f4f3ef`, copy `#b4b4bb`, muted `#a3a3aa`, tertiary `#909098`. Lines are `rgb(255 255 255 / 0.12)` and `rgb(255 255 255 / 0.2)`.
  - Point the refine tokens at the matching `--app-*` token. Action is ink, and action-ink is surface.
  - Delete the base `--ateva-*` colours that no longer have any reader.
- [x] **Step 4:** Rerun the test, then the full web vitest suite, typecheck and lint.
- [x] **Step 5:** Run the axe and public-content e2e suites against port 3100. Screenshot one developer dashboard in light and in Midnight.
- [x] **Step 6:** Commit with `feat(web): dashboards on the counter tokens (plain light/dark)`.

## Execution notes

- **Third layer:** a third colour layer, `--ateva-*-final`, turned up during implementation. It got the same treatment as the refine layer, and the test covers it.
- **Tertiary tuned:** tertiary was tuned to `#686862` (light) and `#909098` (dark). The first values missed 4.5:1 on the nested surface.
- **Two contrast faults fixed:** axe on a built app found both, using a localhost-only test key and stubbed API responses, in Warm, Mint and Midnight across developer, advertiser and admin.
  - Red-500/600/700 error text on the neutral inset panels; it now uses `--app-danger`.
  - Brand buttons in dark mode, with dark text on a brown fill at 1.8:1; they now keep the action pair.
