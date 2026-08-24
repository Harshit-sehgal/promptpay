import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Regression guard for the WaitLayer→Ateva rename residue (AGENTS.md,
 * "Resolved 2026-08-22 — the rename left the old mark on 16 surfaces").
 *
 * Fifteen pages plus the OpenGraph card once rendered a rounded badge holding
 * a green bare `W`. Every text gate stayed green because none asserted on the
 * mark — the copy said "Ateva" while the badge showed the old brand's initial.
 * `components/brand-mark.tsx` is now the single source for the mark, and
 * `Sidebar` renders it by default (`brandLetter` is opt-in with NO default).
 *
 * This is deliberately the cheap check the audit note prescribed: fail if any
 * component ships a brand-coloured badge whose entire content is a hardcoded
 * single uppercase letter. Sub-brand letters remain possible (the admin red
 * "A" uses `bg-red-500`, which is not matched here) but must be a conscious
 * prop, never a literal baked into a brand-coloured element.
 */

const SRC_DIR = resolve(__dirname, '..');

function tsxFiles(dir: string = SRC_DIR): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...tsxFiles(full));
    } else if (entry.endsWith('.tsx') && !entry.endsWith('.test.tsx')) {
      out.push(full);
    }
  }
  return out;
}

// A brand colour token followed, within the same opening tag + immediate
// child region, by a lone uppercase letter as the element's text content —
// i.e. `<div className="…bg-brand-500…">W</div>` and friends.
const BRAND_BADGE_LETTER = /(?:bg-brand-\d{3}|from-brand-\d{3})[^<>]{0,160}>\s*[A-Z]\s*</;

describe('brand mark residue guard', () => {
  it('ships no brand-coloured badge holding a hardcoded single letter', () => {
    const offenders: string[] = [];
    for (const file of tsxFiles()) {
      const contents = readFileSync(file, 'utf8');
      if (BRAND_BADGE_LETTER.test(contents)) offenders.push(file);
    }
    expect(offenders).toEqual([]);
  });

  it('keeps Sidebar’s sub-brand letter opt-in with no default', () => {
    const sidebar = readFileSync(join(SRC_DIR, 'components', 'sidebar.tsx'), 'utf8');
    expect(sidebar).not.toMatch(/brandLetter\s*=\s*['"`]/);
  });

  it('the shared BrandMark component exists and is the rendered default', () => {
    const sidebar = readFileSync(join(SRC_DIR, 'components', 'sidebar.tsx'), 'utf8');
    expect(sidebar).toMatch(/import \{ BrandMark \} from '\.\/brand-mark'/);
  });
});
