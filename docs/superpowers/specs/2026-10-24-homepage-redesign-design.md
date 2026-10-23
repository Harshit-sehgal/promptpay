# Homepage redesign: "the counter"

Date: 2026-10-24
Status: approved direction, awaiting build plan
Reference mockup: [`2026-10-24-homepage-redesign-mockup.html`](2026-10-24-homepage-redesign-mockup.html)
(open it in a browser; it is the source of truth for look, motion and copy)

## Why

The current homepage (`apps/web/src/app/page.tsx`) explains Ateva in abstract
terms ("give eligible waits a useful surface") and reads like the generic 2026
AI-startup template: serif display headline, status pill, uppercase mono
eyebrows, rounded cards, numbered steps. Visitors have to read before they
understand the product.

The redesign has one job: **a visitor understands Ateva in about three seconds,
before reading a paragraph.** The page does that by showing the product's one
moment, an AI agent working while one small sponsored card appears, with a live
timer in the headline.

The site's main conversion is still a developer joining the private beta;
the sponsor waitlist is secondary.

## Goals

- The hero communicates the product without the visitor reading body copy.
- The page feels modern and calm, with frosted glass over soft colour fields and
  restrained scroll motion.
- Visitors can choose one of six background palettes, and the choice persists.
- Every public claim stays inside what the product does today (private beta,
  measurement only, no rewards, no campaign billing).

## Non-goals

- No interactive demo in the hero (task chips, typing a prompt, sliders, a
  sponsor card composer). These were tried and rejected as too much.
- No API-traffic, network-log or "search the payload" visuals. Rejected as too
  complex and dated.
- Not a redesign of the dashboards' layouts or workflows (see "Rest of the site").

## Anti-goals (would be a failure even if it shipped)

- The electric blue (`#2b3cff`) from an earlier option. The user rejected it.
- Merging several concepts into one page. The user rejected the combined page.
- Serif display headline + status pill + uppercase eyebrows + numbered steps
  (the "AI slop" look).
- Any earnings promise, revenue-share figure, payout claim, placeholder counter
  ("0+ developers"), or wording that implies Ateva reads prompts or is affiliated
  with Anthropic.

## The page, section by section

Copy below is final unless marked. "Tidewater CI" is a made-up example sponsor
and must stay labelled as an example on the page.

### Nav

- Sticky, inset from the top (12px). Transparent at the top of the page; becomes
  a frosted-glass pill once the page has scrolled more than ~24px.
- Left: `ateva` wordmark. Right: How it works · Privacy · Sponsors · palette
  button · **Join beta** (solid ink pill).
- On narrow screens only the wordmark, palette button and Join beta remain.

### 1. Hero

- Headline: **"Your agent has been working for `0:05`."** The time is a live
  timer set in mono inside a solid ink chip.
- Lede: "That wait is where Ateva shows one small sponsored card. Nothing you
  type is sent."
- Primary action: **Join the beta**. Beside it in quiet text: "Free · private
  beta · VS Code".
- Right column, both frosted glass:
  - an agent window: `claude › fix the flaky checkout test`, then a status line
    that cycles `Working… → Reading 14 files… → Running tests… → Writing a fix…
→ ✓ Done. 3 files changed.` with a pulsing dot (green when done);
  - the sponsored card: "Tidewater CI / 2,000 free build minutes a month for
    open-source repos." with the footer `Sponsored — wait state detected` and a ✕.
    That footer is the real caption the VS Code extension renders
    (`apps/vscode-extension/src/ad-panel.ts`).
- **One clock drives the hero.** It ticks once per second from 0:00 to 0:12,
  holds for three seconds, and loops. The card is visible from **0:01 to 0:11**.
  It enters in about **0.28s** (fade + 10px rise); the user asked for this to
  be fast.
- On load the headline words rise in one after another (~40ms apart, 0.6s each),
  then the lede (+0.4s) and the action row (+0.5s).

### 2. One wait, start to finish

- Heading: "One wait, start to finish." Lede: "The card only exists while your
  agent works. Nothing shows up while you type or read code."
- Three frosted-glass panels, each headed by a timer chip instead of a number:
  - `0:00`: agent window "Working…". Caption: "You hand your agent a task and wait."
  - `0:01`: "Running tests…" plus a small solid sponsor card. Caption: "One
    labelled card appears. Close it any time."
  - `0:12`: "✓ Done. 3 files changed." Caption: "Your agent finishes. The card
    is gone."

### 3. Here's everything we see

- Heading: "Here's everything we see."
- Two glass panels:
  - **Sent to Ateva:** A wait started · Which tool it was · The card was shown ·
    For how long · Your country (from the system locale) · Session and device
    IDs.
  - **Never sent:** Your prompts · Your code · Terminal output · File and repo
    names. Each item gets an ink strike-through line that **draws left to right
    when the panel scrolls into view**, one after another.
- Under the panels, one quiet line links to the full privacy policy, which
  covers consent, request IDs and abuse controls. The heading stays "Here's
  everything we see." because the list above is now complete at the level a
  visitor cares about.

### 4. Sponsors

- Heading: "Reach developers while their agent works."
- Lede: "One card per wait, clearly labelled, counted only once it has actually
  been on screen. Founding sponsors can join the waitlist now. Nothing is billed
  during the beta."
- Action: **Join the sponsor waitlist** (to `/advertisers`).
- Right: the Tidewater card (glass, footer "Sponsored · on screen 5.2s") above a
  dashed empty card "Your product / One line, one link, one clear label."

### 5. Close

- One large glass panel: **"Your next wait could be `0:07` well spent."** The
  timer mirrors the hero clock. Action: **Join the beta**.
- Footer line: "Private beta: measuring delivery only. No rewards and no campaign
  billing yet. Tidewater CI is an example sponsor." It sits above the global
  `SiteFooter`.
- **The global `SiteFooter` stays**, restyled with the new tokens and type. It
  keeps every link it has today: cookie settings, CCPA "Do Not Sell", payout,
  advertiser and data-retention policies, Privacy, Terms, Status.

### Removed from the homepage

- `BetaSignalPlanner` is deleted along with its two e2e tests in
  `apps/web/e2e/a11y.spec.ts`. `LandingProductShowcase` is replaced by the new
  sections.

## Visual system

| Role                  | Value                                                                                                                                           |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Display type          | Inter Tight 800, tight tracking (about -0.045em), slight positive word-spacing so words don't touch                                             |
| UI / body             | Geist 400–600                                                                                                                                   |
| Utility / live values | Geist Mono 400–500, tabular numerals for timers                                                                                                 |
| Ink                   | `#111111` (light palettes)                                                                                                                      |
| Copy / quiet          | `#55554f` / `#8a8a84`                                                                                                                           |
| Radii                 | 16px objects, 22px panels, 28px closing panel, pills fully round                                                                                |
| Glass                 | `rgb(255 255 255 / .52)`, 1px `rgb(255 255 255 / .85)` edge, inset top highlight, soft long shadow, `backdrop-filter: blur(22px) saturate(1.4)` |
| Glass fallback        | Without `backdrop-filter` support, use the stronger `rgb(255 255 255 / .72)` fill                                                               |

**Colour fields.** Each section has two or three very large blurred circles
(60px blur; 48px on phones) in the palette's four colours. They sit behind the
glass, are not clipped per section (no hard edges between sections), and drift
at different speeds on scroll (parallax factor about ±0.05–0.12). Horizontal
overflow is clipped at the page level, so they never cause sideways scrolling.

### Palettes

The visitor picks one; **Warm** is the default.

| Palette  | Page      | c1        | c2        | c3        | c4        | Field opacity |
| -------- | --------- | --------- | --------- | --------- | --------- | ------------- |
| Warm     | `#f4f3ef` | `#f6c9a8` | `#c4dcc6` | `#d6cdea` | `#ecdcb4` | .75           |
| Sunset   | `#fbf3ee` | `#ff9f87` | `#ffc98f` | `#f7a8cc` | `#ffd9a0` | .70           |
| Mint     | `#f2f6f3` | `#9fe3c6` | `#b3d9f2` | `#f1ec9e` | `#c9eedd` | .75           |
| Lavender | `#f6f3f9` | `#c8b4f4` | `#f5b5d4` | `#b9c6f6` | `#e6d4fa` | .75           |
| Citrus   | `#f7f6ee` | `#d6f08c` | `#ffe07a` | `#ffbf8c` | `#c5ecb0` | .70           |
| Midnight | `#0f0f12` | `#6b4cf6` | `#ff7a45` | `#18b88f` | `#c43d8f` | .45           |

Midnight also inverts the system: ink `#f4f3ef`, copy `#b4b4bb`, quiet `#85858d`,
glass `rgb(255 255 255 / .07)` with a `.16` edge, solid surfaces `#1c1c21`,
buttons light with dark text, and `color-scheme: dark`. All values are in the
mockup's CSS.

## Background picker (visitor setting)

- A 38px round glass button in the nav showing a conic swatch of the current
  palette. It opens a frosted menu titled "Background" with six options in a
  3×2 grid (swatch + name).
- Choosing an option recolours the page immediately (0.6s colour transition on
  the page and the fields).
- **Persistence:** saved in `localStorage` under one key and applied by a small
  inline script **before first paint**, so there is no flash of the wrong palette.
  Storage access is wrapped in try/catch; if it fails, the picker still works for
  the visit.
- **First visit:** Warm, or Midnight when `prefers-color-scheme: dark`. Until
  the visitor picks something, the page follows changes to the system setting.
- **Accessibility:** the menu is a `radiogroup` of `radio` buttons with
  `aria-checked`. The trigger has `aria-expanded`. Arrow keys move and apply,
  Esc closes and returns focus, and a click outside closes it.
- On phones the menu is pinned 16px from both screen edges under the nav.
- This replaces the existing light/dark toggle (`apps/web/src/components/theme-toggle.tsx`,
  storage key `ateva-landing-theme`). **Migration:** if the new key is unset and
  the old key says `dark`, set Midnight once and remove the old key. Any other
  old value is ignored.

## Motion

- **Scroll reveal:** headings, ledes, panels and buttons fade and rise 28px over
  0.6s as they enter the viewport. Siblings are staggered 70ms apart, and each
  element reveals once.
- **Strike-through draw** in the privacy section: 0.45s per line, 110ms apart.
- **Parallax** on the colour fields only, never on text or panels (an element
  that both reveals and moves would fight over `transform`).
- **Reduced motion:** with `prefers-reduced-motion: reduce`, everything renders
  in its final state. There are no reveals, no parallax, no pulsing dot, and the
  strike lines are already drawn. The timer still updates, because it carries
  information rather than decoration.

## Rest of the site

- The other public pages (`/advertisers`, `/pricing`, `/faq`, `/manifesto`,
  `/status`, `/changelog`, `/comparison`, `/contact`, `/security`, policies and
  legal) adopt the same type, palette tokens, glass nav and footer. Their
  content and structure stay as they are.
- The auth pages (`AuthShell`) adopt the tokens and glass panels.
- The palette picker and colour orbs appear on public pages only, including
  legal, FAQ and auth pages. They do not appear on the dashboards.
- The dashboards (developer, advertiser, admin, `.app-shell`, `Sidebar`) get the
  new type and tokens in a plain light/dark version: no orbs, no picker, no
  glass beyond the nav. Their dark mode keeps today's `.dark` mechanism, mapped
  to the Midnight ink values.
- **Rollout in two PRs:** (1) tokens, type, homepage and all public pages;
  (2) dashboards.

## Constraints from the repo

- **Fonts are self-hosted.** `apps/web/src/__tests__/globals-css-integrity.test.ts`
  forbids `@import url()` webfonts and currently asserts that
  `instrument-serif-400.ttf` and `--font-serif` are wired in `layout.tsx`. The
  new fonts (Inter Tight, Geist, Geist Mono) must be added as local files via
  `next/font/local`, and that test must be updated deliberately rather than
  worked around. The mockup's Google Fonts link is for preview only. The same
  test also asserts the header has `aria-label="Primary navigation"` and
  `backdrop-blur-xl`; keep the label and update the blur assertion if needed.
- **Copy gate.** `scripts/public-payment-claims.test.mjs` (run by
  `pnpm test:release-gates`) rejects revenue-share and similar claims in public
  page source. New copy must pass it.
- **Accessibility gate.** `apps/web/e2e/a11y.spec.ts` runs axe (WCAG 2.1 AA) on
  every public route at desktop and mobile. Every palette, Midnight included,
  must pass contrast for body copy, quiet text on glass, and the timer chip.
- **CSS debt.** `apps/web/src/app/globals.css` is about 8,850 lines with several
  overlapping token layers. The new system must be one token layer. Retire the
  `landing-*` rules the new homepage no longer uses, rather than layering on top.
- The OpenGraph image (`apps/web/src/app/opengraph-image.tsx`) uses Instrument
  Serif. Update it to the new type, or keep it until a follow-up; say which.

## Left to the builder

- Component boundaries and file layout, within the repo's existing conventions.
- Whether the reveal and parallax are a small shared hook or CSS scroll-driven
  animations with a JS fallback, as long as the behaviour above holds.
- Exact parallax factors and orb positions per section, keeping the mockup's
  feel.
- How the hero clock pauses when the tab is hidden.
- Replacing the comparison page's inaccurate claims (self-serve campaigns,
  "open-source extension", Cursor/Windsurf/Cline listed separately) is a
  separate content fix. Don't carry those claims into new components.

## Calls made during the builder check (mine, check these)

- **Signed-in state stays.** The hero and close buttons read "Open dashboard"
  for signed-in visitors, as today. The nav keeps its Log in link.
- **Anchors.** New section ids replace `#product`, `#developers`, `#trust`,
  `#how-it-works`. `SiteHeader` and `SiteFooter` links are re-pointed to them
  (how it works, privacy, sponsors). No dead anchors.
- **Server-rendered timer.** Without JS, and in the server render, the hero
  clock shows 0:05 with the card visible, and the close clock shows 0:07.
  Ticking starts after hydration. This keeps hydration stable and gives the OG
  image and SEO snapshot a meaningful state.

## Decisions from the builder check (the user's)

All taken as recommended on 2026-10-24: keep and restyle the global footer;
list country and session/device IDs and link the full policy; picker and orbs
on public pages only, plain tokens on dashboards, two PRs; map old "dark" to
Midnight; delete `BetaSignalPlanner` and its tests.
