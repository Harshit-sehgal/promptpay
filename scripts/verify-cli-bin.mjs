import { existsSync, readFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

/**
 * Verifies that every `bin` entry declared in apps/cli/package.json points to
 * a built artifact that actually exists. The CLI `tsc` build emits to
 * `dist/index.js` (rootDir inferred as `src`), so this guards against the
 * packaging bug where `bin` referenced a non-existent `dist/apps/cli/src/...`
 * path (A-043). Run after build, e.g. in CI before `npm publish` / `npm pack`.
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
    console.log(`[verify-cli-bin] OK: ${name} -> ${rel}`);
  }
}

if (!ok) process.exit(1);
