# Dashboard Redesign (Counter Language)

**Status:** the user asked for a complete redesign of the dashboards and skipped the design questions. Every decision below is the builder's call, recorded so it can be reviewed and reversed.

**Supersedes:** the "Rest of the site" dashboard clause of `2026-10-24-homepage-redesign-design.md`, which allowed plain tokens, no glass and no picker.

## Intent

The signed-in dashboards (developer, advertiser and admin, 27 pages) should feel like the same product as the homepage. Today they are a cool-grey admin template, styled from outside by about 390 `.app-shell [class~=…]` override rules left over from three earlier passes. The redesign gives them the counter language, and replaces the override sediment with a small set of components.

- **Thesis:** the dashboard is the counter's ledger. It shows what verified waits turned into, in big honest numbers.
- **Signature:** the headline figure on each overview sits in the ink "clock chip" from the hero (`0:01`), in Geist Mono on an ink background.
- **Anti-signature:** nothing that reads as generated: no blurred colour blobs, no frosted glass, no mono all-caps eyebrows, no pill-shaped everything, no arrow glyphs on links, no em-dash prose, no ledes that only list what the page shows. Also no rainbow status colours and no icon-in-every-heading.

**Revision (2026-10-25):** a first pass put the homepage's full-strength colour fields and glass behind the dashboards. The user asked for the parts that look AI-made to go, keeping it natural but striking. The dashboards are now a ledger: flat paper panels with hairline rules, the palette colour as a solid sidebar spine, a heavy ink rule under each page title, figures in one ruled strip, and the ink clock chip as the single expressive element.

## Goals

- Dashboards join the palette system. The six palettes apply, the picker lives in the sidebar footer, and Midnight still sets `.dark`.
- The palette colour appears once, as the solid sidebar spine (`--c1`), with everything on it in ink. The main column is the plain page colour; there are no colour fields or blur behind content.
- One set of dashboard components in `src/components/dash/`, used by every dashboard page:
  - `PageHeader`: display title over a 2px ink rule, an optional lede that says something specific, actions.
  - `Panel` and `PanelHeader`: the paper container with a hairline edge.
  - `Stat`: label, big mono value, detail.
  - `Pill`: status chip with a tone dot and ink text.
  - `Notice`: a glass strip with a tone bar for errors, warnings and info, in ink text.
  - `ActionLink` and `Button` variants: the ink pill, the glass pill, and a text link with an arrow.
  - `DataTable` styling via the `.dash-table` class.
- A new shell: a solid palette-colour sidebar, the heavy wordmark, nav items as text with the active item in ink, and a footer holding the palette picker, sign out and home.
- The `.app-shell` override layers are removed once no page relies on them.

## Non-goals

- No change to data flow, API calls, routes, permissions, step-up, or the copy's meaning.
- No new features. Empty, loading and error states keep their behaviour and only change look.

## Anti-goals (failure even if it works)

- **Contrast:** any text below WCAG AA in any palette.
- **Over-decoration:** the dashboard getting the homepage's motion theatrics or colour fields. Reveals, parallax and blur stay off here.
- **Tone-coloured text:** status shown only as coloured text. The tone is a dot or bar, and the words stay ink.

## System

- **Type:**
  - Page titles: Inter Tight 800, `clamp(30px, 3.6vw, 44px)`, tracking −0.045em.
  - Section titles: Geist 600, 16px.
  - Labels and table headers: Geist 13px sentence case, in `--copy`.
  - Numbers: Geist Mono with tabular numerals.
- **Colour:** palette tokens only (`--ink`, `--copy`, `--muted`, `--glass*`, `--solid`, `--page`, `--on-ink`). Tone dots use `--ok`, `--warn` and `--bad`, which are new per-mode tokens, decorative and at least 3:1 against glass.
- **Geometry:** panels have a 10px radius and 22px padding. Buttons and inputs are 8px. A row of figures is one ruled strip.
- **Surfaces:** `--solid` for panels, inputs and modals; `--page` for recessed insets. No blur or shadow.

## Verification

- Unit tests, typecheck and lint pass.
- axe passes on all 27 routes in Warm, Mint and Midnight. They render against a localhost build using a throwaway key and stubbed API responses.
- Screenshots of each overview, in light and Midnight.
- Then the user's own signed-in session on real data. The user signs in themselves in the browser pane; no credentials are handled by the builder.
