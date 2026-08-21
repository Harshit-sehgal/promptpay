import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

/**
 * Public payment-claim gate.
 *
 * WaitLayer's advertiser money-in rail (advertiser → Dodo Payments → WaitLayer)
 * is deliberately separate from any future participant money-out rail
 * (WaitLayer → approved payout provider → participant). Public pages must not
 * describe a participant reward as a percentage of, or a claim on, an
 * individual advertiser transaction — that would describe WaitLayer as
 * splitting customer funds, which is not what it does and not what its payment
 * provider is approved for.
 *
 * The page list is derived from the filesystem rather than hand-maintained.
 * The first version of this gate listed five pages, and the 60/30/10 split it
 * was written to prohibit was sitting unnoticed in /terms, /faq and
 * /comparison the whole time — a hard-coded list cannot notice what is not in
 * it. This mirrors `a11y-coverage.test.ts`, which was fixed the same way.
 */

const APP_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../apps/web/src/app');
const COMPONENT_DIR = resolve(APP_DIR, '../components');

/**
 * Route prefixes that require a session. Their copy is not *public*, so they
 * are exempt from the required-wording checks below — but NOT from the
 * prohibited-claim scan. The 60/30/10 split survived longest on the
 * authenticated developer dashboard, which is precisely the surface an
 * external reviewer logs in to inspect.
 */
const PRIVATE_PREFIXES = ['/admin', '/advertiser/', '/developer', '/auth'];

/**
 * Operator-only internal tooling, exempt from the prohibited-claim scan.
 *
 * `/admin/ledger` reports the legacy split engine's existing balances for
 * reconciliation. That is an internal accounting view of data that already
 * exists — not a statement to a user about what they will be paid — and no
 * external reviewer is given admin access. The end-user dashboards under
 * `/developer` and `/advertiser` are deliberately NOT exempt.
 */
const OPERATOR_PREFIXES = ['/admin'];

const PROHIBITED_PUBLIC_CLAIMS = [
  { pattern: /\bUSDC\b/i, label: 'USDC payout claim' },
  { pattern: /compute[- ]credits?/i, label: 'compute-credit payout claim' },
  { pattern: /\brevenue\s+(share|sharing|split)\b/i, label: 'revenue-share claim' },
  { pattern: /\b60\s*\/\s*30\s*\/\s*10\b/i, label: '60/30/10 split claim' },
  { pattern: /\b80\s*\/\s*10\s*\/\s*10\b/i, label: '80/10/10 split claim' },
  {
    // "60% of ad revenue", "80% to the developer", "10% user" — any wording
    // that ties a participant reward to a share of a payment.
    pattern: /\b\d{1,3}\s*%\s*(of|to)?\s*(the\s+)?(ad\s+)?(revenue|developer|user|participant)\b/i,
    label: 'percentage-of-revenue participant share claim',
  },
  { pattern: /media spend goes to you/i, label: 'pass-through media-spend claim' },
];

/**
 * Collapse whitespace so the gate reads the prose the page actually renders.
 * These are JSX sources: a sentence is wrapped across lines at whatever column
 * the formatter chose, so matching the raw file would both miss prohibited
 * claims that happen to straddle a line break and fail on required wording for
 * the same reason.
 */
function normalize(source) {
  return source.replace(/\s+/g, ' ');
}

/** Every `page.tsx` in the app, as `[route, filePath]`. */
function allPages(dir = APP_DIR, prefix = '') {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      const segment = /^[([_]/.test(entry) ? '' : `/${entry}`;
      out.push(...allPages(full, prefix + segment));
    } else if (entry === 'page.tsx') {
      out.push([prefix === '' ? '/' : prefix, full]);
    }
  }
  return out;
}

function isPublic(route) {
  return !PRIVATE_PREFIXES.some((p) => route === p.replace(/\/$/, '') || route.startsWith(p));
}

/** Every `page.tsx` reachable without a session, as `[route, filePath]`. */
function publicPages() {
  return allPages().filter(([route]) => isPublic(route));
}

/**
 * Components a public page renders directly. Claims move into components as
 * easily as they sit in pages — the homepage's rewards calculator is the case
 * that matters — so scanning only `page.tsx` would leave an open door.
 */
function importedComponents(pageSource) {
  const files = [];
  for (const [, name] of pageSource.matchAll(/from '@\/components\/([\w./-]+)'/g)) {
    for (const candidate of [`${name}.tsx`, `${name}.ts`, `${name}/index.tsx`]) {
      const full = join(COMPONENT_DIR, candidate);
      try {
        if (statSync(full).isFile()) {
          files.push(full);
          break;
        }
      } catch {
        // Not this extension; try the next candidate.
      }
    }
  }
  return files;
}

/** Rendered surface as `{ label, content }`, with each file read at most once. */
function surfaceFor(pages) {
  const seen = new Map();
  for (const [route, file] of pages) {
    const source = readFileSync(file, 'utf8');
    if (!seen.has(file)) seen.set(file, { label: route, content: normalize(source) });
    for (const component of importedComponents(source)) {
      if (!seen.has(component)) {
        seen.set(component, {
          label: `${route} → ${component.slice(COMPONENT_DIR.length + 1)}`,
          content: normalize(readFileSync(component, 'utf8')),
        });
      }
    }
  }
  return [...seen.values()];
}

/** Everything a signed-in reviewer can reach, including the dashboards. */
const renderedSurface = () =>
  surfaceFor(
    allPages().filter(([route]) => !OPERATOR_PREFIXES.some((p) => route.startsWith(p))),
  );
/** Only what an anonymous visitor can reach. */
const publicSurface = () => surfaceFor(publicPages());

function pageContent(surface, route) {
  const found = surface.find((entry) => entry.label === route);
  assert.ok(found, `expected ${route} to be part of the scanned public surface`);
  return found.content;
}

test('no rendered page claims a participant share of an advertiser payment', () => {
  const surface = renderedSurface();

  for (const { label, content } of surface) {
    for (const { pattern, label: claim } of PROHIBITED_PUBLIC_CLAIMS) {
      assert.equal(
        pattern.test(content),
        false,
        `${label} contains a prohibited public ${claim}; advertiser billing and participant compensation must remain separate`,
      );
    }
  }
});

test('the money-flow pages state the separated flow explicitly', () => {
  const surface = publicSurface();

  const advertiserPolicy = pageContent(surface, '/advertiser-policy');
  assert.match(advertiserPolicy, /Dodo Payments/i);
  assert.match(advertiserPolicy, /settled to WaitLayer/i);
  assert.match(advertiserPolicy, /separate payout provider/i);

  const payoutPolicy = pageContent(surface, '/payout-policy');
  assert.match(payoutPolicy, /independent/i);
  assert.match(payoutPolicy, /fiat/i);
  assert.match(payoutPolicy, /Dodo Payments/i);

  const terms = pageContent(surface, '/terms');
  assert.match(terms, /set independently by WaitLayer/i);
  assert.match(terms, /not a percentage of/i);
});

test('guards the guard — discovery and patterns must actually work', () => {
  const surface = publicSurface();
  const labels = surface.map((entry) => entry.label);

  // Discovery that silently returned nothing would make the gate above pass
  // forever. These are the pages that carry the money story.
  assert.ok(surface.length > 15, `expected the public surface to be discovered, got ${labels}`);
  for (const route of [
    '/',
    '/pricing',
    '/terms',
    '/faq',
    '/comparison',
    '/manifesto',
    '/payout-policy',
    '/advertiser-policy',
  ]) {
    assert.ok(labels.includes(route), `${route} is missing from the scanned public surface`);
  }

  // The authenticated dashboards are the surface an external reviewer logs in
  // to inspect, and are where the 60/30/10 split survived longest. If they fall
  // out of the prohibited-claim scan, the gate loses the case it was widened for.
  const scanned = renderedSurface().map((entry) => entry.label);
  assert.ok(scanned.includes('/developer'), '/developer is not covered by the claim scan');
  assert.ok(scanned.includes('/advertiser'), '/advertiser is not covered by the claim scan');
  assert.ok(
    !scanned.some((label) => label.startsWith('/admin')),
    'operator-only /admin pages should stay exempt',
  );

  // The homepage pulls the rewards calculator in from /components; if that
  // resolution breaks, claims could move there unchecked.
  assert.ok(
    labels.some((label) => label.includes('→')),
    'no component was resolved from a public page — the import scan is broken',
  );

  // And the patterns must still fire on the exact copy this gate was written
  // to remove.
  const knownBad = [
    'Developers receive 60% of ad revenue (80% during launch incentive period).',
    'the standard split will be 60% to the developer, 30% to the platform',
    'Transparent revenue split (planned)',
    'paid out in USDC',
  ];
  for (const sample of knownBad) {
    assert.ok(
      PROHIBITED_PUBLIC_CLAIMS.some(({ pattern }) => pattern.test(sample)),
      `no prohibited-claim pattern matches: ${sample}`,
    );
  }
});
