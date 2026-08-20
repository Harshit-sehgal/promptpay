import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const PUBLIC_PAYMENT_PAGES = [
  'apps/web/src/app/page.tsx',
  'apps/web/src/app/pricing/page.tsx',
  'apps/web/src/app/payout-policy/page.tsx',
  'apps/web/src/app/advertiser-policy/page.tsx',
  'apps/web/src/app/manifesto/page.tsx',
];

const PROHIBITED_PUBLIC_CLAIMS = [
  { pattern: /\bUSDC\b/i, label: 'USDC payout claim' },
  { pattern: /compute[- ]credits?/i, label: 'compute-credit payout claim' },
  { pattern: /\brevenue\s+share\b/i, label: 'revenue-share claim' },
  { pattern: /\b60\s*\/\s*30\s*\/\s*10\b/i, label: '60/30/10 split claim' },
  { pattern: /\b80\s*\/\s*10\s*\/\s*10\b/i, label: '80/10/10 split claim' },
  { pattern: /\b60%\b/i, label: 'fixed 60% participant share claim' },
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

test('public payment messaging matches the separated beta money flow', async () => {
  const pages = await Promise.all(
    PUBLIC_PAYMENT_PAGES.map(async (path) => ({
      path,
      content: normalize(await readFile(path, 'utf8')),
    })),
  );

  for (const { path, content } of pages) {
    for (const { pattern, label } of PROHIBITED_PUBLIC_CLAIMS) {
      assert.equal(
        pattern.test(content),
        false,
        `${path} contains prohibited public ${label}; advertiser billing and participant compensation must remain separate`,
      );
    }
  }

  const advertiserPolicy = pages.find((page) =>
    page.path.endsWith('advertiser-policy/page.tsx'),
  )?.content;
  assert.match(advertiserPolicy ?? '', /Dodo Payments/i);
  assert.match(advertiserPolicy ?? '', /settled to WaitLayer/i);
  assert.match(advertiserPolicy ?? '', /separate payout provider/i);

  const payoutPolicy = pages.find((page) => page.path.endsWith('payout-policy/page.tsx'))?.content;
  assert.match(payoutPolicy ?? '', /independent/i);
  assert.match(payoutPolicy ?? '', /fiat/i);
  assert.match(payoutPolicy ?? '', /Dodo Payments/i);
});
