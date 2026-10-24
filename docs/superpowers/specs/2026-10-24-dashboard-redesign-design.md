# Dashboard Redesign (Counter Language)

**Status:** the user asked for a complete redesign of the dashboards and skipped the design questions. Every decision below is the builder's call, recorded so it can be reviewed and reversed.

**Supersedes:** the "Rest of the site" dashboard clause of `2026-10-24-homepage-redesign-design.md`, which allowed plain tokens, no glass and no picker.

## Intent

The signed-in dashboards (developer, advertiser and admin, 27 pages) should feel like the same product as the homepage. Today they are a cool-grey admin template, styled from outside by about 390 `.app-shell [class~=…]` override rules left over from three earlier passes. The redesign gives them the counter language, and replaces the override sediment with a small set of components.

- **Thesis:** the dashboard is the counter's ledger. It shows what verified waits turned into, in big honest numbers.
- **Signature:** the headline figure on each overview sits in the ink "clock chip" from the hero (`0:01`), in Geist Mono on an ink background.
- **Anti-signature:** no rainbow status colours, no shadowed admin cards, and no icon-in-every-heading.

## Goals

- Dashboards join the palette system. The six palettes apply, the picker lives in the sidebar footer, and Midnight still sets `.dark`.
- A faint copy of the colour fields sits behind the content, at the reading-page strength. Content sits on glass panels.
- One set of dashboard components in `src/components/dash/`, used by every dashboard page:
  - `PageHeader`: mono eyebrow, display title, lede, actions.
  - `Panel` and `PanelHeader`: the glass container.
  - `Stat`: label, big mono value, detail.
  - `Pill`: status chip with a tone dot and ink text.
  - `Notice`: a glass strip with a tone bar for errors, warnings and info, in ink text.
  - `ActionLink` and `Button` variants: the ink pill, the glass pill, and a text link with an arrow.
  - `DataTable` styling via the `.dash-table` class.
- A new shell: a glass sidebar rail, the heavy wordmark, nav items as text with the active item an ink pill, and a footer holding the palette picker, sign out and home.
- The `.app-shell` override layers are removed once no page relies on them.

## Non-goals

- No change to data flow, API calls, routes, permissions, step-up, or the copy's meaning.
- No new features. Empty, loading and error states keep their behaviour and only change look.

## Anti-goals (failure even if it works)

- **Contrast:** any text below WCAG AA in any palette.
- **Over-decoration:** the dashboard getting the homepage's motion theatrics. Reveals and parallax stay off here.
- **Tone-coloured text:** status shown only as coloured text. The tone is a dot or bar, and the words stay ink.

## System

- **Type:**
  - Page titles: Inter Tight 800, `clamp(30px, 3.6vw, 44px)`, tracking −0.045em.
  - Section titles: Geist 600, 16px.
  - Eyebrows and table headers: Geist Mono 11–12px uppercase, in `--muted`.
  - Numbers: Geist Mono with tabular numerals.
- **Colour:** palette tokens only (`--ink`, `--copy`, `--muted`, `--glass*`, `--solid`, `--page`, `--on-ink`). Tone dots use `--ok`, `--warn` and `--bad`, which are new per-mode tokens, decorative and at least 3:1 against glass.
- **Geometry:** panels have a 20px radius and 22px padding. Pills and buttons are 999px. Inputs are 12px.
- **Glass:** `--glass` for panels, `--glass-strong` for inputs and the sidebar.

## Verification

- Unit tests, typecheck and lint pass.
- axe passes on all 27 routes in Warm, Mint and Midnight. They render against a localhost build using a throwaway key and stubbed API responses.
- Screenshots of each overview, in light and Midnight.
- Then the user's own signed-in session on real data. The user signs in themselves in the browser pane; no credentials are handled by the builder.
