# Legal documents — moved

The cookie policy, data-retention schedule, and GDPR DPA used to live here as
markdown and were read at request time by the `/legal/*` pages. **They now live
in the page components themselves:**

| Document                | Source of truth                                         |
| ----------------------- | ------------------------------------------------------- |
| Cookie Policy           | `apps/web/src/app/legal/cookie-policy/page.tsx`         |
| Data Retention Schedule | `apps/web/src/app/legal/data-retention/page.tsx`        |
| GDPR DPA                | `apps/web/src/app/legal/gdpr-dpa/page.tsx`              |
| Terms of Service        | `apps/web/src/app/terms/page.tsx` (always lived here)   |
| Privacy Policy          | `apps/web/src/app/privacy/page.tsx` (always lived here) |

## Why (A-087)

The pages read `path.join(process.cwd(), 'docs', 'legal', '*.md')`. During
`next build` the cwd is `apps/web`, so the read always threw ENOENT — the
markdown was at the **repo root**, one level up and outside the app. A
`try/catch` silently substituted the string `"Content unavailable."`, and
because all three routes are statically prerendered, that string was frozen
into the shipped HTML.

The result: three legal documents, linked from the footer of **every page**,
that had never once rendered their real content — in production or locally.
Every quality gate passed the whole time, because the code was valid and the
build genuinely succeeded.

Two rules came out of it:

1. **Legal copy is code.** It ships in the component tree — no filesystem
   reads, nothing to trace into a standalone or serverless bundle.
2. **Never silently fall back to an apology string.** If a document cannot be
   found, that is a build failure, not a paragraph. The `catch` is gone.

`.e2e/tests/public-content.spec.ts` now asserts real body text on these pages
and the rest of the public surface, so this class of failure fails CI instead
of shipping. The original markdown remains in git history.
