import { existsSync, readFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

/**
 * Verifies that every `bin` entry declared in apps/cli/package.json points to
 * a built artifact that actually exists and is executable by npm as a Node
 * bin. Run after build, e.g. in CI before `npm publish` / `npm pack`.
 */
const here = dirname(fileURLToPath(import.meta.url));
const cliPkgPath = resolve(here, '../apps/cli/package.json');
const pkg = JSON.parse(readFileSync(cliPkgPath, 'utf-8'));

const bins = typeof pkg.bin === 'string' ? { cli: pkg.bin } : pkg.bin ?? {};
let ok = true;
for (const [name, rel] of Object.entries(bins)) {
  const abs = resolve(dirname(cliPkgPath), rel);
  if (!existsSync(abs)) {
    console.error(`[verify-cli-bin] FAIL: bin "${name}" -> ${rel} does not exist. Run the CLI build first.`);
    ok = false;
  } else {
    const firstLine = readFileSync(abs, 'utf-8').split(/\r?\n/, 1)[0];
    if (firstLine !== '#!/usr/bin/env node') {
      console.error(`[verify-cli-bin] FAIL: bin "${name}" -> ${rel} is missing the Node shebang.`);
      ok = false;
    } else {
      console.log(`[verify-cli-bin] OK: ${name} -> ${rel}`);
    }
  }
}

if (!ok) process.exit(1);
